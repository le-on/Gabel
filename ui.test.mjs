// UI integration checks in a small DOM adapter. These do not replace visual browser QA.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const root = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(root, 'dist/index.html'), 'utf8');
const engine = readFileSync(join(root, 'dist/engine.js'), 'utf8');
const audioSource = readFileSync(join(root, 'dist/audio.js'), 'utf8');
const app = readFileSync(join(root, 'dist/app.js'), 'utf8');
const saveKey = 'gabriel-abendessen-run-v1';
const displayNumber = value => Number(value.toFixed(1)).toLocaleString('de-DE');
const flushAudio = () => new Promise(resolve => setImmediate(resolve));

function mount(storage = new Map(), unavailable = false, options = {}) {
  let now = 0;
  let frame;
  const listeners = new Map();
  const windowListeners = new Map();
  const layout = { stage: { left: 400, top: 240, width: 700, height: 430, border: 2 } };
  const rect = ({ left = 0, top = 0, width = 0, height = 0 }) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top });
  const elements = new Map();
  const timers = new Map();
  let nextTimer = 0;
  const decode = text => text.replace(/&(?:amp|lt|gt|quot|#39|apos);/g, entity => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'" }[entity]));
  const voidTags = new Set(['AREA', 'BASE', 'BR', 'COL', 'EMBED', 'HR', 'IMG', 'INPUT', 'LINK', 'META', 'PARAM', 'SOURCE', 'TRACK', 'WBR']);
  function descendants(element) { return element.children.flatMap(child => [child, ...descendants(child)]); }
  function matchesSimple(element, selector) {
    const tag = selector.match(/^[\w-]+/)?.[0];
    if (tag && element.tagName !== tag.toUpperCase()) return false;
    const id = selector.match(/#([\w-]+)/)?.[1];
    if (id && element.id !== id) return false;
    for (const match of selector.matchAll(/\.([\w-]+)/g)) if (!element.classList.contains(match[1])) return false;
    for (const match of selector.matchAll(/\[([\w-]+)(?:\s*=\s*['"]?([^'"\]]+)['"]?)?\]/g)) {
      if (!element.hasAttribute(match[1])) return false;
      if (match[2] !== undefined && element.getAttribute(match[1]) !== match[2]) return false;
    }
    return true;
  }
  function matches(element, selector) {
    return selector.split(',').some(part => {
      const pieces = part.trim().replace(/\s*>\s*/g, ' > ').split(/\s+/);
      if (!matchesSimple(element, pieces.pop())) return false;
      let current = element.parentElement;
      while (pieces.length) {
        const piece = pieces.pop();
        if (piece === '>') {
          if (!current || !matchesSimple(current, pieces.pop())) return false;
        } else {
          while (current && !matchesSimple(current, piece)) current = current.parentElement;
          if (!current) return false;
        }
        current = current.parentElement;
      }
      return true;
    });
  }
  function parseInto(parent, markup) {
    const stack = [parent];
    for (const token of markup.matchAll(/<!--[\s\S]*?-->|<![^>]*>|<(?:[^<>"']|"[^"]*"|'[^']*')+>|[^<]+/g)) {
      const value = token[0];
      if (value.startsWith('<!--') || value.startsWith('<!')) continue;
      if (value.startsWith('</')) { if (stack.length > 1) stack.pop(); continue; }
      if (!value.startsWith('<')) { stack.at(-1)._ownText += decode(value); continue; }
      const tag = value.match(/^<([\w-]+)/)?.[1];
      if (!tag) continue;
      const node = new Element('', tag.toUpperCase());
      for (const match of value.slice(tag.length + 1, -1).matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
        node.setAttribute(match[1], decode(match[2] ?? match[3] ?? match[4] ?? ''));
      }
      stack.at(-1).append(node);
      if (!voidTags.has(node.tagName) && !value.endsWith('/>')) stack.push(node);
    }
  }
  class Element {
    constructor(id = '', tagName = 'DIV') {
      this.id = id; this.tagName = tagName; this.hidden = false; this.disabled = false;
      this._innerHTML = ''; this._ownText = ''; this.dataset = new Proxy({}, {
        set: (target, key, value) => { target[key] = String(value); this.attributes.set(`data-${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`, String(value)); return true; },
        deleteProperty: (target, key) => { delete target[key]; this.attributes.delete(`data-${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`); return true; },
      }); this.style = { setProperty(name, value) { this[name] = String(value); }, getPropertyValue(name) { return this[name] || ''; }, removeProperty(name) { delete this[name]; } };
      this.open = false; this.children = []; this.attributes = new Map(); this.listeners = new Map();
      this.parentElement = null; this.className = ''; this.nodeType = 1;
      const getClasses = () => new Set(this.className.split(/\s+/).filter(Boolean));
      this.classList = {
        add: (...names) => { this.className = [...new Set([...getClasses(), ...names])].join(' '); },
        remove: (...names) => { this.className = [...getClasses()].filter(name => !names.includes(name)).join(' '); },
        toggle: (name, enabled = !getClasses().has(name)) => { this.classList[enabled ? 'add' : 'remove'](name); return enabled; },
        contains: name => getClasses().has(name),
      };
    }
    get innerHTML() { return this._innerHTML; }
    set innerHTML(markup) { this._innerHTML = String(markup); this._ownText = ''; this.children.forEach(child => { child.parentElement = null; }); this.children = []; parseInto(this, this._innerHTML); }
    get textContent() { return this._ownText + this.children.map(child => child.textContent).join(''); }
    set textContent(value) { this._innerHTML = ''; this._ownText = String(value); this.children.forEach(child => { child.parentElement = null; }); this.children = []; }
    get parentNode() { return this.parentElement; }
    get isConnected() { return this === dom || Boolean(this.parentElement?.isConnected); }
    get offsetWidth() { return this.getBoundingClientRect().width; }
    get offsetHeight() { return this.getBoundingClientRect().height; }
    addEventListener(type, handler) { this.listeners.set(type, [...this.listeners.get(type) || [], handler]); }
    setAttribute(key, value) {
      this.attributes.set(key, String(value));
      if (key === 'id') { this.id = String(value); elements.set(this.id, this); }
      if (key === 'class') this.className = String(value);
      if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = String(value);
      if (['hidden', 'disabled', 'open'].includes(key)) this[key] = true;
    }
    getAttribute(key) { if (key === 'class') return this.className; if (key === 'id') return this.id || null; return this.attributes.get(key) ?? null; }
    hasAttribute(key) { if (['hidden', 'disabled', 'open'].includes(key)) return this[key]; return this.attributes.has(key); }
    removeAttribute(key) { this.attributes.delete(key); if (key.startsWith('data-')) delete this.dataset[key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())]; if (['hidden', 'disabled', 'open'].includes(key)) this[key] = false; }
    append(...nodes) { for (const node of nodes) { node.remove(); this.children.push(node); node.parentElement = this; } }
    appendChild(node) { this.append(node); return node; }
    replaceChildren(...nodes) { this.innerHTML = ''; this.append(...nodes); }
    insertAdjacentHTML(_position, markup) { this.innerHTML += markup; }
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null; }
    contains(node) { return this === node || this.children.some(child => child.contains(node)); }
    closest(selector) { let current = this; while (current) { if (matches(current, selector)) return current; current = current.parentElement; } return null; }
    matches(selector) { return matches(this, selector); }
    focus() { const previous = document.activeElement; if (previous === this) return; document.activeElement = this; if (previous) emit('focusout', { target: previous, relatedTarget: this }); emit('focusin', { target: this, relatedTarget: previous }); }
    blur() { if (document.activeElement === this) { document.activeElement = document.body; emit('focusout', { target: this, relatedTarget: document.body }); } }
    scrollIntoView() {}
    getBoundingClientRect() {
      if (this.rectOverride) return rect(typeof this.rectOverride === 'function' ? this.rectOverride() : this.rectOverride);
      const stage = layout.stage;
      const border = stage.border || 0;
      const content = { left: stage.left + border, top: stage.top + border, width: stage.width - border * 2, height: stage.height - border * 2 };
      const mobile = context.window.innerWidth <= 760;
      if (this.id === 'battle-stage') return rect(stage);
      if (['combat-fx-layer', 'table-loadout'].includes(this.id)) return rect(content);
      if (['enemy-layer', 'effect-layer'].includes(this.id)) return rect({ left: content.left + content.width * .15, top: content.top + content.height * .24, width: content.width * .73, height: content.height * .39 });
      if (this.classList.contains('enemy')) {
        const lane = elements.get('enemy-layer').getBoundingClientRect();
        const boss = this.classList.contains('boss');
        const width = boss ? 72 : mobile ? 38 : 48;
        const iconHeight = (boss ? mobile ? 42 : 52 : mobile ? 27 : 31) * 1.3;
        const height = Math.max(50, iconHeight + (boss ? 22 : 7));
        return rect({ left: lane.left + parseFloat(this.style.left || '0') / 100 * lane.width - width / 2, top: lane.top + parseFloat(this.style.top || '0') / 100 * lane.height - height / 2, width, height });
      }
      if (this.classList.contains('enemy-icon') && this.parentElement?.classList.contains('enemy')) {
        const enemy = this.parentElement.getBoundingClientRect();
        const boss = this.parentElement.classList.contains('boss');
        return rect({ left: enemy.left, top: enemy.top, width: enemy.width, height: (boss ? mobile ? 42 : 52 : mobile ? 27 : 31) * 1.3 });
      }
      if (this.classList.contains('table-item')) {
        const index = Number(this.dataset.slot || 0);
        const width = mobile ? 38 : 52;
        const height = mobile ? 38 : 48;
        return rect({ left: content.left + content.width * (.11 + index % 3 * .14) - width / 2, top: content.top + content.height * (.66 + Math.floor(index / 3) * .15) - height / 2, width, height });
      }
      if (this.classList.contains('table-item-icon') && this.parentElement?.classList.contains('table-item')) {
        const item = this.parentElement.getBoundingClientRect();
        const width = mobile ? 26 : 35;
        const height = width;
        return rect({ left: item.left + (item.width - width) / 2, top: item.top + (item.height - height) / 2, width, height });
      }
      if (this.id === 'item-tooltip') return rect({ left: 40, top: 200, width: 320, height: 200 });
      return rect({ left: 40, top: 200, width: 300, height: 180 });
    }
    showModal() { this.open = true; this.querySelector('button')?.focus(); }
    close() { if (!this.open) return; this.open = false; this.emit('close'); }
    querySelectorAll(selector) { return descendants(this).filter(element => matches(element, selector)); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    emit(type, event = {}) { for (const handler of this.listeners.get(type) || []) handler({ target: this, ...event }); }
  }
  function isVisible(element) {
    if (!element || !element.isConnected) return false;
    const target = element;
    for (let node = element; node; node = node.parentElement) {
      if (node.hidden || node.getAttribute('aria-hidden') === 'true') return false;
      if (node.tagName === 'DIALOG' && !node.open) return false;
      if (node.tagName === 'DETAILS' && !node.open && !node.querySelector('summary')?.contains(target)) return false;
    }
    return true;
  }
  const dom = new Element('', 'DOCUMENT');
  parseInto(dom, html);
  const document = {
    hidden: false, body: dom.querySelector('body'), documentElement: dom.querySelector('html'), activeElement: dom.querySelector('body'),
    getElementById: id => { assert.ok(elements.has(id), `Missing DOM id ${id}`); return elements.get(id); },
    createElement: tag => new Element('', tag.toUpperCase()),
    addEventListener: (type, handler) => listeners.set(type, [...listeners.get(type) || [], handler]),
    querySelectorAll: selector => dom.querySelectorAll(selector),
    querySelector: selector => dom.querySelector(selector),
  };
  const emit = (type, event = {}) => { for (const handler of listeners.get(type) || []) handler({ preventDefault() {}, ...event }); };
  const localStorage = {
    getItem: key => { if (unavailable) throw new Error('Storage unavailable'); return storage.get(key) ?? null; },
    setItem: (key, value) => { if (unavailable) throw new Error('Storage unavailable'); storage.set(key, value); },
    removeItem: key => storage.delete(key),
  };
  const context = {
    document, localStorage, console, performance: { now: () => now },
    window: { innerWidth: 1440, innerHeight: 900, scrollX: 0, scrollY: 0, scrollTo() {}, addEventListener: (type, handler) => windowListeners.set(type, [...windowListeners.get(type) || [], handler]) },
    requestAnimationFrame: callback => { frame = callback; },
    setTimeout: (callback, delay = 0) => { const id = ++nextTimer; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout: id => timers.delete(id), matchMedia: () => ({ matches: Boolean(options.reducedMotion) }),
  };
  runInNewContext(engine, context, { filename: 'engine.js' });
  runInNewContext(audioSource, context, { filename: 'audio.js' });
  let audioSpy = null;
  if (options.audioSpy) {
    const calls = [];
    const state = { enabled: false, volume: .45, activeVoices: 0 };
    let unlocked = false;
    let suspended = true;
    audioSpy = {
      calls,
      unlock() { calls.push({ method: 'unlock', at: now }); unlocked = true; suspended = false; return Promise.resolve(true); },
      setEnabled(enabled) { state.enabled = Boolean(enabled); if (!state.enabled) state.activeVoices = 0; calls.push({ method: 'setEnabled', enabled: state.enabled, at: now }); return state.enabled; },
      setVolume(volume) { state.volume = Math.max(0, Math.min(1, Number(volume))); calls.push({ method: 'setVolume', volume: state.volume, at: now }); return state.volume; },
      play(cue, settings = {}) {
        const accepted = state.enabled && state.volume > 0 && unlocked && !suspended;
        calls.push({ method: 'play', cue, options: { ...settings }, accepted, at: now });
        return accepted;
      },
      suspend() { suspended = true; state.activeVoices = 0; calls.push({ method: 'suspend', at: now }); return Promise.resolve(); },
      resume() { if (unlocked) suspended = false; calls.push({ method: 'resume', at: now }); return Promise.resolve(unlocked); },
      stop() { state.activeVoices = 0; calls.push({ method: 'stop', at: now }); },
      destroy() { state.enabled = false; state.activeVoices = 0; suspended = true; calls.push({ method: 'destroy', at: now }); },
      getState() { return { ...state }; },
    };
    const factory = () => { calls.push({ method: 'create', at: now }); return audioSpy; };
    factory.createAudio = factory;
    context.AbendessenAudio = factory;
  }
  const events = [];
  let liveRun = null;
  const coreUpdate = context.AbendessenCore.updateBattle;
  context.AbendessenCore.updateBattle = (...args) => { liveRun = args[0]; const batch = coreUpdate(...args); events.push(...batch); return batch; };
  runInNewContext(app, context, { filename: 'app.js' });
  const click = (id, properties = {}) => { const element = elements.get(id); assert.ok(element, `No element ${id}`); assert.equal(element.disabled, false, `${id} is disabled`); assert.ok(isVisible(element), `${id} is not visible in the current screen`); element.emit('click', properties); emit('click', { target: element, ...properties }); };
  const select = (kind, index, within = '') => { const target = document.querySelector(`${within ? `${within} ` : ''}[data-${kind}="${index}"]`); assert.ok(target, `No ${kind} ${index} within ${within || 'document'}`); assert.ok(isVisible(target), `${kind} ${index} is not visible in the current screen`); emit('click', { target }); };
  const step = milliseconds => {
    now += milliseconds;
    for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); }
    frame(now);
  };
  const tick = (count = 1) => { for (let index = 0; index < count; index++) step(80); };
  const advance = (milliseconds, frameMilliseconds = 16) => {
    let remaining = milliseconds;
    while (remaining > 0) { const delta = Math.min(remaining, frameMilliseconds); step(delta); remaining -= delta; }
  };
  const resize = ({ width = context.window.innerWidth, height = context.window.innerHeight, stage = {} } = {}) => {
    context.window.innerWidth = width;
    context.window.innerHeight = height;
    Object.assign(layout.stage, stage);
    for (const handler of windowListeners.get('resize') || []) handler({ type: 'resize' });
  };

  return { elements, storage, click, select, tick, step, advance, resize, now: () => now, emit, document, events, audio: audioSpy, isVisible, core: context.AbendessenCore, live: () => liveRun || JSON.parse(storage.get(saveKey)), read: () => JSON.parse(storage.get(saveKey)) };
}

function acceptedSounds(ui, cue) {
  return ui.audio.calls.filter(call => call.method === 'play' && call.accepted && (!cue || call.cue === cue));
}

async function enableTestSound(ui) {
  if (ui.elements.get('sound-button').getAttribute('aria-pressed') !== 'true') ui.click('sound-button');
  await flushAudio();
}

function savedFixture(configure) {
  const context = {};
  runInNewContext(engine, context);
  const core = context.AbendessenCore;
  const run = core.createRun('ui-integration-fixture');
  configure?.(run, core);
  if (run.version === 2 && Number.isFinite(run.coins)) run.stats.coinsEarned = run.coins + run.stats.coinsSpent;
  return new Map([[saveKey, JSON.stringify(run)]]);
}

function setShop(run, core, ids, coins = run.coins) {
  run.coins = coins;
  run.shop = {
    offers: ids.map((id, index) => id ? { uid: `test-offer-${index}`, id, price: core.ITEMS[id].price, locked: false } : null),
    rerolls: 0, healUsed: false, visit: run.course,
  };
}

function chooseVisibleEncounter(ui, preferredChoice) {
  const encounter = ui.core.getEncounter(ui.read());
  assert.ok(encounter, 'An explicit event choice requires an actual pending encounter');
  assert.equal(ui.elements.get('game').dataset.screen, 'event');
  assert.equal(ui.isVisible(ui.elements.get('event-screen')), true);
  const buttons = ui.document.querySelectorAll('#event-choices [data-event-choice]');
  const button = buttons.find(node => !node.disabled && (!preferredChoice || node.dataset.eventChoice === preferredChoice));
  assert.ok(button, 'The event offers a visible affordable choice');
  const choiceId = button.dataset.eventChoice;
  ui.select('event-choice', choiceId, '#event-choices');
  assert.equal(ui.core.getEncounter(ui.read()), null, 'The chosen encounter resolves once');
  return { encounter, choiceId };
}

function assertTableMatchesInventory(ui) {
  const screen = ui.read().phase === 'prep' ? '#slots .slot' : '#table-loadout .table-item';
  const tableItems = ui.document.querySelectorAll(screen);
  assert.equal(tableItems.length, 6, 'The visible equipment grid has exactly six positions');
  assert.ok(tableItems.every(node => ui.isVisible(node)), 'Equipment assertions use the current screen rather than a hidden duplicate');
  const slots = ui.read().slots;
  tableItems.forEach((node, index) => {
    assert.equal(Number(node.dataset.slot), index, 'Table position references the same engine slot');
    if (slots[index]) {
      const definition = ui.core.getItemDefinition(slots[index]);
      assert.ok(node.getAttribute('aria-label').includes(definition.name), `Table slot ${index} names ${definition.name}`);
      if (definition.iconPath) {
        assert.equal(node.querySelector('img.item-art')?.getAttribute('src'), definition.iconPath, `Table slot ${index} uses the current item artwork`);
      } else {
        assert.ok(node.textContent.includes(definition.icon), `Table slot ${index} displays ${definition.name}`);
      }
    } else {
      assert.equal(node.querySelector('img.item-art'), null, `Empty table slot ${index} has no item artwork`);
      for (const definition of Object.values(ui.core.ITEMS)) assert.ok(!node.textContent.includes(definition.icon), `Empty table slot ${index} must not display an equipped item`);
    }
  });
}

function readyCombat(itemId, enemyCount = 2, configure, options = {}) {
  const ui = mount(savedFixture((run, core) => {
    run.slots = [{ id: itemId, level: 1, uid: 'test-weapon', invested: 0 }, null, null, null, null, null];
    if (Number.isInteger(options.course)) {
      run.course = options.course;
      run.shop.visit = options.course;
      run.stats.coursesCleared = options.course;
    }
    core.startBattle(run);
    run.battle.cooldowns[0] = 0;
    run.battle.nextSpawn = 999;
    run.battle.enemies = Array.from({ length: enemyCount }, (_, index) => ({
      ...core.ENEMIES.erbsen, type: 'erbsen', uid: `test-enemy-${index}`, lane: index % 3,
      x: .55 + index * .12, hp: 100, maxHp: 100, shield: 0, maxShield: 0, speed: 0, slowUntil: 0,
    }));
    configure?.(run, core);
  }), false, options);
  ui.click('continue-button');
  ui.click('serve-button');
  return ui;
}

test('UI starts a run, rearranges items and persists the actual engine state', () => {
  const ui = mount();
  ui.click('new-run-button');
  assert.equal(ui.elements.get('game').hidden, false);
  assert.equal(ui.read().phase, 'prep');
  assert.equal(ui.document.activeElement.id, 'screen-title');
  assert.equal(ui.isVisible(ui.document.activeElement), true, 'Starting play moves keyboard focus away from the hidden welcome screen');
  assert.equal(ui.read().version, 2);
  assert.equal(ui.read().coins, ui.core.ECONOMY.startingCoins);
  assert.ok(ui.elements.get('income-preview').textContent.includes(`+${ui.core.getCourseIncome(0)}`));
  assert.equal(ui.read().slots.filter(Boolean).length, 2);
  assert.equal(ui.read().shop.offers.length, 4);
  assert.equal(ui.read().slots[0].id, 'serviette');
  ui.select('slot', 0); ui.select('slot', 2);
  assert.equal(ui.read().slots[0], null);
  assert.equal(ui.read().slots[2].id, 'serviette');
  assert.equal(ui.document.activeElement.dataset.slot, '2');
});

test('combat pauses with Space even after a speed button has focus', () => {
  const ui = mount(); ui.click('new-run-button'); ui.click('shop-serve-button');
  ui.click('speed-button'); ui.document.activeElement = ui.elements.get('speed-button');
  let prevented = false;
  ui.emit('keydown', { code: 'Space', repeat: false, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(ui.elements.get('paused-sticker').hidden, false);
  const time = ui.read().battle.time; ui.tick(50);
  assert.equal(ui.read().battle.time, time);
  ui.click('serve-button');
  assert.equal(ui.elements.get('paused-sticker').hidden, true);
});

test('saved combat restores paused and can be resumed; home also pauses safely', () => {
  const first = mount(); first.click('new-run-button'); first.click('shop-serve-button'); first.tick(80);
  const savedTime = first.read().battle.time;
  assert.ok(savedTime > 0);
  const restored = mount(first.storage); restored.click('continue-button');
  assert.equal(restored.document.activeElement.id, 'pause-button');
  assert.equal(restored.isVisible(restored.document.activeElement), true, 'A continued battle focuses its visible resume control');
  assert.match(restored.elements.get('run-eyebrow').textContent, /PAUSIERT/);
  assert.equal(restored.elements.get('paused-sticker').hidden, false);
  restored.tick(80); assert.equal(restored.read().battle.time, savedTime);
  restored.click('serve-button'); restored.tick(80);
  assert.ok(restored.read().battle.time > savedTime);
  assert.doesNotMatch(restored.elements.get('run-eyebrow').textContent, /PAUSIERT/, 'Resuming removes the paused header status');
  restored.click('pause-button');
  assert.match(restored.elements.get('run-eyebrow').textContent, /PAUSIERT/, 'Pausing restores the header status without a full re-render');
  restored.click('home-button');
  const homeTime = restored.read().battle.time; restored.tick(80);
  assert.equal(restored.read().battle.time, homeTime);
});

test('actual UI callbacks progress through shops and combat into a final result', () => {
  const ui = mount(); ui.click('new-run-button');
  let battles = 0;
  const encountered = new Set();
  while (!['won', 'lost'].includes(ui.read().phase)) {
    const phase = ui.read().phase;
    if (phase === 'prep') {
      const encounter = ui.core.getEncounter(ui.read());
      if (encounter) {
        assert.ok([2, 4].includes(battles), 'Only the second and fourth clears interrupt the shop');
        assert.equal(ui.elements.get('event-progress').textContent, `${battles / 2} / 2`);
        assert.equal(encountered.has(encounter.id), false, 'A later event never repeats an earlier one');
        encountered.add(encounter.id);
        chooseVisibleEncounter(ui);
      } else if (battles > 0) {
        assert.ok([1, 3, 5].includes(battles), 'The other clears return directly to shopping');
        assert.equal(ui.elements.get('game').dataset.screen, 'shop');
      }
      for (let index = 0; index < 4; index++) {
        const offer = ui.read().shop.offers[index];
        if (offer && offer.price <= ui.read().coins) ui.select('buy', index);
      }
      ui.click('shop-serve-button'); battles++;
      if (battles === 1) { ui.click('speed-button'); ui.click('speed-button'); }
    }
    else {
      let guard = 0;
      while (ui.elements.get('game').dataset.screen === 'battle' && !ui.elements.get('result-dialog').open && guard++ < 1500) ui.tick();
      assert.ok(guard < 1500, 'Combat must finish');
    }
    assert.ok(battles <= 6);
  }
  assert.equal(ui.elements.get('result-dialog').open, true);
  assert.ok(['won', 'lost'].includes(ui.read().phase));
  assert.equal(ui.read().resultRecorded, true);
  assert.match(ui.elements.get('result-stats').innerHTML, /GERICHTE ABGEWEHRT/);
  ui.click('play-again-button');
  assert.equal(ui.read().phase, 'prep');
  assert.equal(ui.elements.get('result-dialog').open, false);
});

test('damaged JSON saves recover without disabling subsequent autosave', () => {
  const ui = mount(new Map([[saveKey, '{broken'], ['gabriel-abendessen-record-v1', '{broken']]));
  ui.click('new-run-button');
  assert.equal(ui.read().phase, 'prep');
  ui.click('shop-serve-button');
  assert.equal(ui.read().phase, 'battle');
});

test('unavailable local storage does not prevent playing', () => {
  const ui = mount(new Map(), true);
  ui.click('new-run-button'); ui.click('shop-serve-button'); ui.tick(30);
  assert.equal(ui.elements.get('game').hidden, false);
  assert.match(ui.elements.get('save-status').textContent, /nicht verfügbar/);
});

test('sound remains opt-in while the accessible volume setting persists independently of the run', async () => {
  const ui = mount(new Map(), false, { audioSpy: true });
  assert.equal(ui.elements.get('sound-button').getAttribute('aria-pressed'), 'false');
  assert.equal(ui.audio.getState().enabled, false);
  assert.equal(acceptedSounds(ui).length, 0);
  assert.equal(ui.audio.calls.some(call => call.method === 'unlock'), false, 'Loading the page does not unlock audio');
  ui.click('help-button');
  const slider = ui.elements.get('sound-volume');
  assert.equal(slider.tagName, 'INPUT');
  assert.equal(slider.getAttribute('type'), 'range');
  assert.equal(slider.getAttribute('min'), '0');
  assert.equal(slider.getAttribute('max'), '100');
  assert.equal(slider.getAttribute('step'), '5');
  assert.equal(Number(slider.value), 45);
  slider.value = '70'; slider.emit('input');
  assert.equal(ui.audio.getState().volume, .7);
  assert.equal(Number(ui.storage.get('gabriel-abendessen-volume-v1')), .7);
  assert.match(ui.elements.get('sound-volume-value').textContent, /70\s*%/);
  assert.equal(ui.elements.get('sound-button').getAttribute('aria-pressed'), 'false', 'Adjusting volume does not opt into sound');
  assert.equal(ui.storage.has(saveKey), false, 'Audio preferences do not require creating or changing a run');
  ui.elements.get('help-dialog').close();
  await enableTestSound(ui);
  assert.equal(ui.elements.get('sound-button').getAttribute('aria-pressed'), 'true');
  assert.equal(ui.audio.getState().enabled, true);
  assert.equal(ui.storage.get('gabriel-abendessen-sound-v1'), 'true');
  const restored = mount(ui.storage, false, { audioSpy: true });
  assert.equal(restored.elements.get('sound-button').getAttribute('aria-pressed'), 'true');
  assert.equal(restored.audio.getState().volume, .7);
  assert.equal(Number(restored.elements.get('sound-volume').value), 70);
  assert.equal(acceptedSounds(restored).length, 0, 'Saved preferences never autoplay a sound on reload');
  assert.equal(restored.audio.calls.some(call => call.method === 'unlock'), false);
  restored.click('sound-button'); await flushAudio();
  assert.equal(restored.audio.getState().enabled, false);
  assert.ok(restored.audio.calls.some(call => call.method === 'setEnabled' && call.enabled === false), 'Mute reaches the audio engine so active and planned voices are cleared');
  const silent = mount(ui.storage); // The actual audio factory has no AudioContext in this adapter.
  silent.click('sound-button'); await flushAudio();
  silent.click('new-run-button'); silent.click('shop-serve-button'); silent.tick(30);
  assert.equal(silent.read().phase, 'battle', 'A browser without Web Audio remains playable after a sound gesture');
});

test('starting an audible battle unlocks audio after clearing old voices', async () => {
  const ui = mount(new Map([['gabriel-abendessen-sound-v1', 'true']]), false, { audioSpy: true });
  ui.click('new-run-button'); await flushAudio();
  const before = ui.audio.calls.length;
  ui.click('shop-serve-button'); await flushAudio();
  const lifecycle = ui.audio.calls.slice(before);
  const lastStop = lifecycle.findLastIndex(call => ['stop', 'suspend'].includes(call.method));
  const lastUnlock = lifecycle.findLastIndex(call => call.method === 'unlock');
  assert.ok(lastStop >= 0, 'Starting combat clears any preceding voices');
  assert.ok(lastUnlock > lastStop, 'The final audio unlock must survive the cleanup rather than be invalidated by a later stop');
  assert.equal(ui.read().phase, 'battle');
  ui.tick(40);
  assert.ok(acceptedSounds(ui, 'launch').length > 0, 'The newly started fight can actually play its own activation sounds');
});

test('real purchases, fusion, upgrading, selling, rerolling and event choices use distinct audio cues', async () => {
  const ui = mount(savedFixture((run, core) => { setShop(run, core, ['beer', 'beer', 'serviette', 'paper'], 60); }), false, { audioSpy: true });
  ui.click('continue-button'); await enableTestSound(ui);
  ui.select('buy', 0);
  assert.equal(acceptedSounds(ui, 'buy').length, 1);
  assert.equal(acceptedSounds(ui, 'buy')[0].options.itemId, 'beer');
  ui.select('buy', 1);
  assert.equal(acceptedSounds(ui, 'fusion').length, 1);
  assert.equal(acceptedSounds(ui, 'fusion')[0].options.itemId, 'beer');
  assert.equal(acceptedSounds(ui, 'fusion')[0].options.level, 2);
  const index = ui.read().slots.findIndex(item => item?.id === 'beer');
  ui.select('slot', index, '#slots'); ui.click('upgrade-button');
  assert.equal(ui.read().slots[index].level, 3);
  assert.equal(acceptedSounds(ui, 'upgrade').length, 1);
  assert.equal(acceptedSounds(ui, 'upgrade')[0].options.itemId, 'beer');
  ui.click('sell-button');
  assert.equal(acceptedSounds(ui, 'sell').length, 1);
  assert.equal(acceptedSounds(ui, 'sell')[0].options.itemId, 'beer');
  ui.click('reroll-button');
  assert.equal(acceptedSounds(ui, 'reroll').length, 1);
  const storage = pendingEncounterFixture('anka');
  storage.set('gabriel-abendessen-sound-v1', 'true');
  const eventUi = mount(storage, false, { audioSpy: true });
  eventUi.click('continue-button'); await flushAudio();
  chooseVisibleEncounter(eventUi, 'call');
  const cue = acceptedSounds(eventUi, 'event');
  assert.equal(cue.length, 1);
  assert.equal(cue[0].options.eventId, 'anka');
  const before = acceptedSounds(eventUi).length;
  eventUi.emit('click', { target: { closest: selector => selector === '[data-event-choice]' ? { dataset: { eventChoice: 'call' } } : null } });
  assert.equal(acceptedSounds(eventUi).length, before, 'An already resolved response cannot replay its cue');
});

test('combat audio identifies the real item and waits for arrival while lifecycle changes discard stale sounds', async () => {
  for (const id of ['serviette', 'awp', 'paper']) {
    const ui = readyCombat(id, 1, run => { Object.assign(run.battle.enemies[0], { hp: 1000, maxHp: 1000, x: .95, speed: 0 }); }, { audioSpy: true });
    await enableTestSound(ui);
    ui.step(16);
    const activation = ui.events.find(event => event.type === 'activate');
    const launch = acceptedSounds(ui, 'launch');
    assert.equal(launch.length, 1);
    assert.equal(launch[0].options.itemId, activation.itemId);
    assert.equal(launch[0].options.effect, activation.effect);
    const projectile = ui.document.querySelector('#combat-fx-layer .item-projectile[data-slot="0"]');
    assert.ok(projectile);
    assert.equal(acceptedSounds(ui, id === 'paper' ? 'shield' : 'impact').length, 0, 'No hit or shield cue precedes the visible arrival');
    ui.click('pause-button'); await flushAudio();
    const pausedCalls = acceptedSounds(ui).length;
    assert.ok(ui.audio.calls.some(call => call.method === 'suspend'));
    ui.advance(1200);
    assert.equal(acceptedSounds(ui).length, pausedCalls);
    assert.ok(projectile.isConnected);
    ui.click('help-button'); ui.advance(300);
    assert.equal(acceptedSounds(ui).length, pausedCalls, 'An open dialog does not leak combat sounds');
    ui.elements.get('help-dialog').close();
    ui.click('serve-button'); await flushAudio();
    let frames = 0;
    while (projectile.isConnected && frames++ < 80) ui.step(8);
    assert.ok(frames < 80);
    const hit = acceptedSounds(ui, id === 'paper' ? 'shield' : 'impact');
    assert.equal(hit.length, 1, 'The actual arrived action produces exactly one target cue');
    assert.equal(hit[0].options.itemId, id);
    assert.ok(Number.isFinite(hit[0].options.pan) && Math.abs(hit[0].options.pan) <= 1, 'Panning follows a bounded real source or target position');
    assert.equal(acceptedSounds(ui, 'launch').length, 1, 'Resuming does not replay the earlier launch');
    if (id === 'serviette') {
      ui.live().battle.cooldowns[0] = 0; ui.step(16);
      const pending = ui.document.querySelector('#combat-fx-layer .item-projectile');
      assert.ok(pending);
      const impacts = acceptedSounds(ui, 'impact').length;
      ui.click('home-button'); await flushAudio();
      assert.equal(pending.isConnected, false);
      const afterHome = acceptedSounds(ui).length;
      ui.advance(1500);
      assert.equal(acceptedSounds(ui).length, afterHome, 'Home clears pending battle audio');
      ui.click('continue-button'); await flushAudio();
      ui.click('serve-button'); await flushAudio(); ui.advance(350);
      assert.equal(acceptedSounds(ui, 'impact').length, impacts, 'Continuing does not replay a hit discarded on Home');
      ui.click('restart-button');
      const afterDialog = acceptedSounds(ui).length;
      ui.advance(300);
      assert.equal(acceptedSounds(ui).length, afterDialog);
      ui.click('confirm-restart-button'); await flushAudio();
      const afterRestart = acceptedSounds(ui).length;
      ui.advance(800);
      assert.equal(acceptedSounds(ui).length, afterRestart, 'A new preparation has no sounds queued by the previous fight');
    } else if (id === 'awp') {
      ui.document.hidden = true; ui.emit('visibilitychange'); await flushAudio();
      const hiddenCalls = acceptedSounds(ui).length;
      ui.advance(1500);
      assert.equal(acceptedSounds(ui).length, hiddenCalls);
      ui.document.hidden = false; ui.emit('visibilitychange');
      assert.equal(ui.elements.get('paused-sticker').hidden, false, 'Returning to a hidden fight preserves its explicit pause');
    } else {
      ui.click('sound-button'); await flushAudio();
      const mutedCalls = acceptedSounds(ui).length;
      ui.live().battle.cooldowns[0] = 0; ui.step(16); ui.advance(350);
      assert.equal(acceptedSounds(ui).length, mutedCalls, 'Mute suppresses both a new activation and its later arrival');
      assert.equal(ui.audio.getState().enabled, false);
    }
  }
});

test('the shop equipment grid rearranges the actual items that later appear on the battle table', () => {
  const ui = mount(savedFixture(run => { run.slots[1] = { id: 'ventilator', level: 1, uid: 'test-ventilator', invested: 6 }; })); ui.click('continue-button');
  assertTableMatchesInventory(ui);
  ui.select('slot', 0, '#slots');
  ui.select('slot', 2, '#slots');
  assert.equal(ui.read().slots[0], null);
  assert.equal(ui.read().slots[2].id, 'serviette');
  assertTableMatchesInventory(ui);
  ui.select('slot', 2, '#slots');
  ui.select('slot', 1, '#slots');
  assert.equal(ui.read().slots[1].id, 'serviette');
  assert.equal(ui.read().slots[2].id, 'ventilator');
  assertTableMatchesInventory(ui);
  ui.click('shop-serve-button');
  assertTableMatchesInventory(ui);
});

test('dragging shop equipment updates the prepared loadout', () => {
  const ui = mount(); ui.click('new-run-button');
  const data = new Map();
  const dataTransfer = { setData: (kind, value) => data.set(kind, value), getData: kind => data.get(kind) || '' };
  ui.emit('dragstart', { target: ui.document.querySelector('#slots [data-slot="0"]'), dataTransfer });
  ui.emit('drop', { target: ui.document.querySelector('#slots [data-slot="2"]'), dataTransfer });
  assert.equal(ui.read().slots[2].id, 'serviette');
  assert.equal(ui.read().slots[0], null);
  assertTableMatchesInventory(ui);
});

test('hover reveals current item statistics and synergies without moving or selecting it', () => {
  const ui = mount(savedFixture(run => { run.slots[1] = { id: 'brotdose', level: 1, uid: 'test-brotdose', invested: 6 }; }));
  ui.click('continue-button');
  const before = JSON.stringify(ui.read().slots);
  const target = ui.document.querySelector('#slots [data-slot="0"]');
  ui.emit('pointerover', { target, relatedTarget: null, clientX: 540, clientY: 520 });
  const tooltip = ui.elements.get('item-tooltip');
  assert.equal(tooltip.hidden, false);
  assert.equal(tooltip.getAttribute('role'), 'tooltip');
  assert.match(tooltip.textContent, /Serviette/);
  const actualStats = ui.core.getItemStats(ui.read(), 0);
  assert.ok(tooltip.textContent.includes(`${displayNumber(actualStats.power)} Schaden`), 'Hover shows the current synergy-adjusted strength');
  assert.ok(tooltip.querySelector('.tooltip-stats').textContent.includes(`${displayNumber(actualStats.cooldown)} s`));
  assert.match(tooltip.textContent, /Unauffällig einpacken/);
  assert.equal(JSON.stringify(ui.read().slots), before);
  assert.equal(target.getAttribute('aria-pressed'), 'false', 'Inspecting with the pointer does not arm a move');
  ui.emit('pointerout', { target, relatedTarget: ui.document.body });
  assert.equal(tooltip.hidden, true);
});

test('keyboard focus reveals item help and Escape dismisses it without changing the loadout', () => {
  const ui = mount(); ui.click('new-run-button');
  const target = ui.document.querySelector('#slots [data-slot="3"]');
  const before = JSON.stringify(ui.read().slots);
  target.focus();
  const tooltip = ui.elements.get('item-tooltip');
  assert.equal(tooltip.hidden, false);
  assert.match(tooltip.textContent, /Unfertiges Paper/);
  ui.emit('keydown', { key: 'Escape' });
  assert.equal(tooltip.hidden, true);
  assert.equal(JSON.stringify(ui.read().slots), before);
  target.blur();
  target.focus();
  assert.equal(tooltip.hidden, false);
  target.blur();
  assert.equal(tooltip.hidden, true);
});

test('touch supports shop editing and read-only combat inspection while Tab restores keyboard help', () => {
  const ui = mount(); ui.click('new-run-button');
  const target = ui.document.querySelector('#slots [data-slot="0"]');
  const tooltip = ui.elements.get('item-tooltip');
  ui.emit('pointerover', { target, pointerType: 'touch', relatedTarget: null });
  ui.emit('pointerdown', { target, pointerType: 'touch' });
  target.focus();
  assert.equal(tooltip.hidden, true, 'Touch-generated focus does not open a hover tooltip');
  ui.select('slot', 0, '#slots');
  ui.select('slot', 2, '#slots');
  assert.equal(ui.read().slots[2].id, 'serviette');
  assert.equal(tooltip.hidden, true, 'The loadout remains directly usable by touch');
  ui.emit('keydown', { key: 'Tab' });
  ui.document.querySelector('#slots [data-slot="2"]').blur();
  ui.document.querySelector('#slots [data-slot="2"]').focus();
  assert.equal(tooltip.hidden, false, 'Keyboard navigation restores accessible item inspection');
  assert.match(tooltip.textContent, /Serviette/);
  ui.click('shop-serve-button');
  const combatTarget = ui.document.querySelector('#table-loadout [data-slot="2"]');
  const savedBeforeInspecting = ui.storage.get(saveKey);
  assert.equal(ui.isVisible(combatTarget), true);
  ui.emit('pointerdown', { target: combatTarget, pointerType: 'touch' });
  combatTarget.focus();
  assert.equal(tooltip.hidden, true, 'Touch focus alone still avoids accidental help');
  ui.select('slot', 2, '#table-loadout');
  assert.equal(tooltip.hidden, false, 'Tapping combat equipment reveals its read-only effect help');
  assert.match(tooltip.textContent, /Serviette/);
  assert.equal(tooltip.querySelector('[data-tactic]'), null, 'Inspection exposes no tactic editing controls');
  assert.equal(ui.elements.get('item-detail').hidden, true, 'Combat does not reopen the shop inspector');
  assert.equal(ui.document.querySelector('#table-loadout [data-slot="2"]'), combatTarget, 'Inspection keeps the running table intact instead of re-rendering it');
  assert.equal(combatTarget.getAttribute('aria-pressed'), 'false', 'Inspecting in combat does not select an item for movement');
  assert.equal(ui.storage.get(saveKey), savedBeforeInspecting, 'Read-only combat help neither saves changes nor moves equipment');
  const effectText = tooltip.querySelector('.tooltip-effect');
  ui.emit('pointerdown', { target: effectText, pointerType: 'touch' });
  ui.emit('click', { target: effectText });
  ui.emit('scroll', { target: tooltip });
  assert.equal(tooltip.hidden, false, 'Reading and scrolling inside the tooltip leave it open');
  ui.emit('pointerdown', { target: ui.elements.get('pause-button'), pointerType: 'touch' });
  assert.equal(tooltip.hidden, true, 'Touching outside dismisses combat help');
  assert.equal(ui.storage.get(saveKey), savedBeforeInspecting);
});

test('shop offer hover previews an item without buying; purchase refreshes the table', () => {
  const ui = mount(savedFixture((run, core) => {
    setShop(run, core, ['headset', 'gabel', 'discord', 'kaffee']);
  }));
  ui.click('continue-button');
  const initialCoins = ui.read().coins;
  const offer = ui.document.querySelector('[data-offer="0"]');
  ui.emit('pointerover', { target: offer, relatedTarget: null, clientX: 1200, clientY: 400 });
  const tooltip = ui.elements.get('item-tooltip');
  assert.equal(tooltip.hidden, false);
  assert.match(tooltip.textContent, /Gaming-Headset/);
  const previewStats = ui.core.purchasePreview(ui.read(), 0).stats;
  assert.ok(tooltip.querySelector('.tooltip-stats').textContent.includes(`${displayNumber(previewStats.cooldown)} s`), 'The offer shows the actual post-purchase cooldown');
  assert.equal(ui.read().coins, initialCoins, 'Hover does not buy the item');
  assert.equal(ui.read().slots.filter(Boolean).length, 2);
  ui.select('buy', 0);
  assert.equal(ui.read().phase, 'prep');
  assert.equal(ui.read().coins, initialCoins - ui.core.ITEMS.headset.price);
  assert.equal(ui.read().slots[1].id, 'headset');
  assertTableMatchesInventory(ui);
  const focused = ui.document.activeElement;
  assert.equal(focused.isConnected, true, 'Purchasing does not leave keyboard focus on a removed button');
  if (!tooltip.hidden) {
    const focusedOffer = ui.read().shop.offers[Number(focused.dataset.offer)];
    assert.ok(focusedOffer, 'Visible help belongs to a currently available focused offer');
    assert.ok(tooltip.textContent.includes(ui.core.ITEMS[focusedOffer.id].name));
    assert.doesNotMatch(tooltip.textContent, /Gaming-Headset/, 'Help for the purchased offer is not left behind');
  }
});

test('locking and rerolling offers charges the escalating prices and survives reload', () => {
  const ui = mount(savedFixture((run, core) => { setShop(run, core, ['ventilator', 'headset', 'serviette', 'kaffee'], 6); }));
  ui.click('continue-button');
  const lockedUid = ui.read().shop.offers[0].uid;
  ui.select('lock', 0);
  assert.equal(ui.read().shop.offers[0].locked, true);
  assert.equal(ui.document.activeElement.dataset.lock, '0', 'The newly rendered lock control retains keyboard focus');
  ui.click('reroll-button');
  assert.equal(ui.read().coins, 5);
  assert.equal(ui.read().shop.rerolls, 1);
  assert.equal(ui.read().shop.offers[0].uid, lockedUid);
  assert.equal(ui.read().shop.offers[0].locked, true);
  assert.match(ui.elements.get('coins-value').textContent, /5/);
  const restored = mount(ui.storage); restored.click('continue-button');
  assert.equal(restored.read().coins, 5);
  assert.equal(restored.read().shop.rerolls, 1);
  assert.equal(restored.read().shop.offers[0].uid, lockedUid);
  restored.click('reroll-button');
  assert.equal(restored.read().coins, 3);
  restored.click('reroll-button');
  assert.equal(restored.read().coins, 0);
  assert.equal(restored.read().shop.rerolls, 3);
  assert.equal(restored.elements.get('reroll-button').disabled, true);
  assert.equal(restored.document.activeElement.id, 'shop-summary', 'When reroll becomes unaffordable, focus moves to the shop summary');
});

test('shop healing charges four coins, restores fifteen and is limited to one use per visit', () => {
  const ui = mount(savedFixture(run => { run.willpower = 60; run.coins = 8; }));
  ui.click('continue-button');
  ui.click('heal-button');
  assert.equal(ui.read().coins, 4);
  assert.equal(ui.read().willpower, 75);
  assert.equal(ui.read().shop.healUsed, true);
  assert.equal(ui.elements.get('heal-button').disabled, true);
  assert.equal(ui.document.activeElement.id, 'shop-summary');
  const restored = mount(ui.storage); restored.click('continue-button');
  assert.equal(restored.read().willpower, 75);
  assert.equal(restored.elements.get('heal-button').disabled, true);
});

test('selecting and selling a bought item refunds half its investment and updates the table', () => {
  const ui = mount(savedFixture(run => {
    run.slots[1] = { id: 'ventilator', level: 1, uid: 'bought-ventilator', invested: 6 };
  }));
  ui.click('continue-button');
  const initialCoins = ui.read().coins;
  const zone = ui.elements.get('sell-zone');
  const button = ui.elements.get('sell-button');
  assert.equal(ui.isVisible(zone), true, 'Selling has a visible dedicated area before any item is selected');
  assert.match(ui.elements.get('sell-title').textContent, /Verkaufen/);
  assert.equal(button.disabled, true, 'An unselected item cannot be sold');
  ui.select('slot', 1, '#slots');
  assert.equal(ui.document.querySelector('#sell-zone [data-sell="1"]'), button);
  assert.equal(ui.isVisible(button), true);
  assert.equal(button.disabled, false);
  assert.match(zone.textContent, /Heizlüfter/);
  assert.match(button.textContent, /3\s*Pfand/);
  assert.equal(ui.document.querySelector('#item-detail [data-sell]'), null, 'The inspector no longer duplicates the selling action');
  ui.click('sell-button');
  assert.equal(ui.read().coins, initialCoins + 3);
  assert.equal(ui.read().slots[1], null);
  assertTableMatchesInventory(ui);
  assert.equal(ui.document.activeElement.id, 'sell-title', 'After selling, keyboard focus stays at the visible sale area');
  assert.equal(button.disabled, true);
  assert.equal(button.dataset.sell, undefined);
  assert.equal(ui.elements.get('coins-value').textContent, String(initialCoins + 3));
  const restored = mount(ui.storage); restored.click('continue-button');
  assert.equal(restored.read().slots[1], null, 'Selling is persisted');
  assert.equal(restored.read().coins, initialCoins + 3);
});

test('buying three more starter copies fuses four base items to level three through the shop UI', () => {
  const ui = mount(savedFixture((run, core) => { setShop(run, core, Array(4).fill('serviette'), 12); }));
  ui.click('continue-button');
  ui.emit('pointerover', { target: ui.document.querySelector('[data-offer="0"]'), relatedTarget: null });
  assert.match(ui.elements.get('item-tooltip').textContent, /STUFE 2/);
  const previewPower = ui.core.purchasePreview(ui.read(), 0).stats.power;
  assert.ok(ui.elements.get('item-tooltip').textContent.includes(`${displayNumber(previewPower)} Schaden`));
  ui.select('buy', 0);
  assert.equal(ui.read().slots.find(item => item?.id === 'serviette').level, 2);
  ui.select('buy', 1);
  assert.equal(ui.read().slots.filter(item => item?.id === 'serviette').length, 2);
  assertTableMatchesInventory(ui);
  ui.select('buy', 2);
  const copies = ui.read().slots.filter(item => item?.id === 'serviette');
  assert.equal(copies.length, 1);
  assert.equal(copies[0].level, 3);
  assert.equal(copies[0].invested, 12);
  assert.equal(ui.read().coins, 0);
  assertTableMatchesInventory(ui);
});

test('unaffordable shop actions and unnecessary healing are disabled without changing the save', () => {
  const ui = mount(savedFixture((run, core) => { setShop(run, core, ['serviette', 'paper', 'kaffee', 'headset'], 0); }));
  ui.click('continue-button');
  const buyButtons = ui.document.querySelectorAll('[data-buy]');
  assert.equal(buyButtons.length, 4);
  for (const button of buyButtons) assert.equal(button.disabled, true);
  assert.equal(ui.elements.get('reroll-button').disabled, true);
  assert.equal(ui.elements.get('heal-button').disabled, true);
  const before = ui.storage.get(saveKey);
  ui.select('buy', 0); // Delegated callbacks must also reject the transaction.
  assert.equal(ui.storage.get(saveKey), before);
});

test('offer cards expose help while purchase and lock controls remain separate action targets', () => {
  const ui = mount(savedFixture((run, core) => { setShop(run, core, ['headset', 'gabel', 'discord', 'kaffee']); }));
  ui.click('continue-button');
  const tooltip = ui.elements.get('item-tooltip');
  for (const selector of ['[data-buy="0"]', '[data-lock="0"]']) {
    const button = ui.document.querySelector(selector);
    ui.emit('pointerover', { target: button, relatedTarget: null });
    assert.equal(tooltip.hidden, true);
    button.focus();
    assert.equal(tooltip.hidden, true);
  }
  ui.document.querySelector('[data-offer="0"]').focus();
  assert.equal(tooltip.hidden, false);
  assert.match(tooltip.textContent, /Gaming-Headset/);
  const expanded = ui.document.querySelector('[data-offer="0"] .offer-more');
  assert.ok(expanded);
  expanded.open = true;
  expanded.querySelector('summary').focus();
  assert.equal(tooltip.hidden, true, 'Reading inline effect details does not open a duplicate tooltip');
  ui.emit('pointerover', { target: expanded.querySelector('.offer-description'), relatedTarget: null });
  assert.equal(tooltip.hidden, true, 'Pointer inspection inside expanded details remains unobstructed');
  assert.equal(ui.read().coins, ui.core.ECONOMY.startingCoins);
  assert.equal(ui.read().shop.offers[0].locked, false);
});

test('cleared courses show their actual graduated income and preview the next reward without automatic healing', () => {
  const ui = mount(savedFixture(run => { run.coins = 2; run.willpower = 60; }));
  ui.click('continue-button');
  const encountered = new Set();
  for (let course = 0; course < 5; course++) {
    const beforeCoins = ui.read().coins;
    const beforeWillpower = ui.read().willpower;
    ui.click('shop-serve-button');
    ui.advance(32); // Bind the actual running state before completing the fixture's wave.
    ui.live().battle.spawned = ui.live().battle.total;
    ui.live().battle.enemies = [];
    ui.live().battle.cooldowns.fill(999);
    ui.tick(2);
    const income = ui.core.getCourseIncome(course);
    assert.equal(ui.read().phase, 'prep');
    assert.equal(ui.read().course, course + 1);
    assert.equal(ui.read().coins, beforeCoins + income);
    assert.equal(ui.read().willpower, beforeWillpower);
    assert.equal(ui.read().lastBattle.income, income);
    const encounter = ui.core.getEncounter(ui.read());
    if ([1, 3].includes(course)) {
      assert.ok(encounter, 'Only clears two and four require a decision before shopping');
      assert.equal(ui.elements.get('game').dataset.screen, 'event', 'The reward is granted before the mandatory encounter');
      assert.equal(ui.elements.get('event-progress').textContent, `${(course + 1) / 2} / 2`);
      assert.equal(encountered.has(encounter.id), false, 'The two random events are distinct');
      encountered.add(encounter.id);
      chooseVisibleEncounter(ui);
    } else {
      assert.equal(encounter, null, 'Clears one, three and five do not interrupt shopping');
      assert.equal(ui.elements.get('game').dataset.screen, 'shop');
      assert.equal(ui.isVisible(ui.elements.get('event-screen')), false);
    }
    assert.equal(ui.elements.get('shop-panel').hidden, false);
    assert.equal(ui.elements.get('coins-value').textContent, String(ui.read().coins));
    assert.equal(ui.isVisible(ui.elements.get('income-preview')), true);
    assert.ok(ui.elements.get('income-preview').textContent.includes(`+${ui.core.getCourseIncome(course + 1)}`), 'The shop previews the next actual reward');
    assert.ok(ui.elements.get('round-recap-text').textContent.includes(`+${income}`), 'The compact recap displays the earned reward rather than a fixed six');
  }
  assert.equal(encountered.size, 2);
  assert.equal(ui.read().encounters.history.length, 2);
});

test('version-one reward saves migrate into a usable next shop without a free heal', () => {
  const storage = savedFixture(run => {
    delete run.encounters; // This fixture predates inter-course events.
    run.version = 1;
    run.phase = 'reward';
    run.willpower = 60;
    run.rewardChoices = [{ id: 'headset' }, { id: 'paper' }, { id: 'gabel' }];
    delete run.coins;
    delete run.shop;
    for (const item of run.slots.filter(Boolean)) delete item.invested;
  });
  const ui = mount(storage);
  assert.equal(ui.elements.get('continue-button').hidden, false);
  ui.click('continue-button');
  assert.equal(ui.read().version, 2);
  assert.equal(ui.read().phase, 'prep');
  assert.equal(ui.read().course, 1);
  assert.equal(ui.read().willpower, 60);
  assert.equal(ui.read().coins, ui.core.ECONOMY.startingCoins);
  assert.equal(ui.read().lastBattle.income, 6, 'The old recorded reward remains historical data rather than being rewritten');
  assert.equal(ui.read().shop.offers.length, 4);
  assertTableMatchesInventory(ui);
});

test('one item activation visibly connects its table source with the actual targeted enemy', () => {
  const ui = readyCombat('serviette');
  ui.tick();
  assert.equal(ui.document.querySelectorAll('#combat-fx-layer .item-projectile').length, 1, 'Every actual target gets a visible flight before arrival');
  assert.equal(ui.document.querySelectorAll('#combat-fx-layer .target-impact').length, 0);
  ui.advance(320);
  const activation = ui.events.find(event => event.type === 'activate');
  assert.ok(activation, 'The actual engine triggers the item');
  assert.equal(activation.targets.length, 1);
  const sources = ui.document.querySelectorAll('#combat-fx-layer .item-burst[data-effect-role="source"]');
  assert.equal(sources.length, 1);
  assert.equal(sources[0].dataset.slot, '0');
  assert.ok(ui.document.querySelector('#table-loadout [data-slot="0"]').classList.contains('is-triggering'));
  const targets = ui.document.querySelectorAll('#combat-fx-layer .target-impact[data-effect-role="target"]');
  assert.equal(targets.length, 1);
  assert.equal(targets[0].dataset.enemyUid, activation.targets[0].uid);
  assert.equal(ui.document.querySelectorAll('#combat-fx-layer .item-projectile').length, 0, 'Arrived flights are removed once their impacts appear');
});

test('area attacks create one source burst and exactly one impact per affected enemy', () => {
  const ui = readyCombat('ventilator', 3);
  ui.tick();
  assert.equal(ui.document.querySelectorAll('#combat-fx-layer .item-projectile').length, 3, 'Every actual target gets a visible flight before arrival');
  assert.equal(ui.document.querySelectorAll('#combat-fx-layer .target-impact').length, 0);
  ui.advance(320);
  const activations = ui.events.filter(event => event.type === 'activate');
  const attacks = ui.events.filter(event => event.type === 'attack');
  assert.equal(activations.length, 1);
  assert.equal(attacks.length, 3, 'The actual AoE hits three enemies');
  assert.equal(ui.document.querySelectorAll('#combat-fx-layer [data-effect-role="source"]').length, 1,
    'Per-target damage events must not duplicate the activation origin');
  const impacts = ui.document.querySelectorAll('#combat-fx-layer [data-effect-role="target"]');
  assert.equal(impacts.length, 3);
  assert.deepEqual(impacts.map(node => node.dataset.enemyUid).sort(), Array.from(activations[0].targets, target => target.uid).sort());
  assert.equal(ui.document.querySelectorAll('#combat-fx-layer .item-projectile').length, 0, 'Arrived flights are removed once their impacts appear');
  assert.equal(ui.document.querySelectorAll('#combat-fx-layer .heat-wave').length, 1);
});

test('shield items activate on the table and visibly protect Gabriel without inventing enemy targets', () => {
  const ui = readyCombat('paper', 0);
  ui.tick();
  assert.equal(ui.document.querySelectorAll('#combat-fx-layer .item-projectile').length, 1, 'The shield travels visibly from its item to Gabriel');
  assert.equal(ui.document.querySelectorAll('#combat-fx-layer .shield-aura').length, 0);
  ui.advance(320);
  assert.equal(ui.document.querySelectorAll('#combat-fx-layer .item-projectile').length, 0);
  const activation = ui.events.find(event => event.type === 'activate');
  assert.equal(activation.effect, 'shield');
  assert.equal(activation.targets.length, 0);
  assert.equal(ui.document.querySelectorAll('#combat-fx-layer [data-effect-role="source"]').length, 1);
  assert.equal(ui.document.querySelectorAll('#combat-fx-layer [data-effect-role="target"]').length, 0);
  assert.equal(ui.document.querySelectorAll('#combat-fx-layer .shield-aura').length, 1);
  assert.match(ui.document.querySelector('#combat-fx-layer .item-burst').textContent, /\+6 Schild/);
});

test('an enemy killed in its spawn frame still receives visible target and damage effects', () => {
  const ui = mount(savedFixture((run, core) => {
    run.slots = [{ id: 'serviette', level: 1, uid: 'test-napkin', invested: 0 }, null, null, null, null, null];
    core.startBattle(run);
    run.battle.cooldowns[0] = 0;
  }));
  ui.click('continue-button'); ui.click('serve-button'); ui.tick(4);
  const kill = ui.events.find(event => event.type === 'kill');
  assert.ok(kill, 'The actual first enemy is killed in its spawn frame by the prepared item');
  assert.equal(ui.document.querySelectorAll('#combat-fx-layer [data-effect-role="target"]').length, 0, 'A spawn-frame kill still waits for its projectile to arrive');
  const ghost = ui.document.querySelector('#enemy-layer .enemy');
  assert.ok(ghost?.isConnected, 'The just-killed enemy remains visible as the real shot target');
  assert.equal(enemyHealthPercent(ghost), 0, 'An enemy born and killed in the same frame must never first appear at full health');
  ui.advance(320);
  const target = ui.document.querySelector(`#combat-fx-layer [data-effect-role="target"][data-enemy-uid="${kill.enemyUid}"]`);
  assert.ok(target, 'The activation snapshot keeps the killed enemy visually addressable');
  const damage = ui.events.find(event => event.type === 'attack' && event.enemyUid === kill.enemyUid);
  assert.ok(damage.amount > 0);
  assert.ok(ui.document.querySelectorAll('#battle-stage .floating-effect').some(node => node.textContent.includes(`−${damage.amount}`)), 'Floating damage matches the actual formation-scaled hit');
});

test('all added shop items expose their actual effects and can be bought onto the table', () => {
  for (const id of ['beer', 'snus', 'luca', 'desolator', 'awp', 'batomon', 'podcast', 'umut', 'walkie', 'ritalin']) {
    const ui = mount(savedFixture((run, core) => { setShop(run, core, [id, 'serviette', 'paper', 'kaffee'], 18); }));
    ui.click('continue-button');
    const definition = ui.core.getItemDefinition(id);
    const before = ui.read();
    const card = ui.document.querySelector('[data-offer="0"]');
    ui.emit('pointerover', { target: card, relatedTarget: null });
    const tooltip = ui.elements.get('item-tooltip');
    assert.equal(tooltip.hidden, false, `${id} has visible item help`);
    assert.ok(tooltip.textContent.includes(definition.name), `${id} is named in its tooltip`);
    assert.doesNotMatch(tooltip.textContent, /undefined|NaN/);
    assert.equal(tooltip.querySelector('img.item-art')?.getAttribute('src'), definition.iconPath);
    assert.equal(ui.read().coins, before.coins, 'Inspection is not a purchase');
    ui.select('buy', 0);
    const equipped = ui.read().slots.find(item => item?.id === id);
    assert.ok(equipped, `${id} is equipped after purchase`);
    assert.equal(ui.read().coins, before.coins - definition.price);
    assertTableMatchesInventory(ui);
  }
});

test('beer fusion changes preview, inventory, table, detail and purchase feedback into a Sixpack and then a Bierkasten', () => {
  const ui = mount(savedFixture((run, core) => {
    run.slots[1] = { id: 'beer', level: 1, uid: 'first-beer', invested: 4 };
    setShop(run, core, ['beer', 'beer', 'beer', 'beer'], 12);
  }));
  ui.click('continue-button');
  ui.emit('pointerover', { target: ui.document.querySelector('[data-offer="0"]'), relatedTarget: null });
  const tooltip = ui.elements.get('item-tooltip');
  assert.match(tooltip.textContent, /Sixpack/);
  assert.match(tooltip.textContent, /STUFE 2/);
  assert.match(tooltip.querySelector('img.item-art')?.getAttribute('src') || '', /beer_sixpack\.svg$/);
  assert.match(ui.document.querySelector('[data-offer="0"]').textContent, /Sixpack/);
  ui.select('buy', 0);
  const firstCrate = ui.read().slots.find(item => item?.id === 'beer');
  assert.equal(firstCrate.uid, 'first-beer');
  assert.equal(firstCrate.level, 2);
  assert.match(ui.document.querySelector('#slots [data-slot="1"]').getAttribute('aria-label'), /Sixpack/);
  assert.match(ui.document.querySelector('#slots [data-slot="1"] img.item-art').getAttribute('src'), /beer_sixpack\.svg$/);
  assert.match(ui.elements.get('toast').textContent, /Sixpack/);
  ui.select('slot', 1, '#slots');
  assert.match(ui.elements.get('item-detail').textContent, /Sixpack/);
  assertTableMatchesInventory(ui);
  ui.select('buy', 1);
  assert.equal(ui.read().slots.filter(item => item?.id === 'beer').length, 2, 'A level-two Sixpack and a new base beer remain separate');
  ui.select('buy', 2);
  const crates = ui.read().slots.filter(item => item?.id === 'beer');
  assert.equal(crates.length, 1);
  assert.equal(crates[0].level, 3);
  assert.equal(crates[0].invested, 16);
  assert.match(ui.elements.get('toast').textContent, /Bierkasten/);
  assertTableMatchesInventory(ui);
});

test('upgraded beer and Snus artwork is correct on the reserve bank', () => {
  for (const [id, level, name, path] of [
    ['beer', 2, 'Sixpack', 'assets/items/beer_sixpack.svg'],
    ['snus', 2, 'Päckchen Snus', 'assets/items/snus.svg'],
    ['snus', 3, '10er-Pack Snus', 'assets/items/snus_pack.svg'],
  ]) {
    const ui = mount(savedFixture((run, core) => {
      run.bench.push({ id, level, uid: `reserve-${id}-${level}`, invested: core.ITEMS[id].price * 2 ** (level - 1) });
    }));
    ui.click('continue-button');
    const reserve = ui.document.querySelector('#bench [data-slot="6"]');
    assert.ok(reserve.getAttribute('aria-label').includes(name));
    assert.equal(reserve.querySelector('img.item-art')?.getAttribute('src'), path);
    reserve.focus();
    assert.ok(ui.elements.get('item-tooltip').textContent.includes(name));
    assert.match(ui.elements.get('item-tooltip').textContent, /Reserve.*Inaktiv/i);
  }
});

test('each new item has one visible source activation and matching actual target effects', () => {
  for (const id of ['beer', 'snus', 'luca', 'desolator', 'awp', 'batomon', 'podcast', 'umut', 'walkie', 'ritalin']) {
    const ui = readyCombat(id);
    ui.tick(2);
    ui.advance(320);
    const activation = ui.events.find(event => event.type === 'activate' && event.itemId === id);
    assert.ok(activation, `${id} actually triggers through the engine`);
    const sources = ui.document.querySelectorAll('#combat-fx-layer [data-effect-role="source"]');
    assert.equal(sources.length, 1, `${id} has exactly one visible origin`);
    assert.equal(sources[0].dataset.effect, ui.core.ITEMS[id].effect);
    assert.ok(sources[0].textContent.trim().length > 0, `${id} explains its activation`);
    const targets = ui.document.querySelectorAll('#combat-fx-layer [data-effect-role="target"]');
    assert.equal(targets.length, activation.targets.length, `${id} only highlights actual targets`);
    assert.deepEqual(targets.map(node => node.dataset.enemyUid).sort(), Array.from(activation.targets, target => target.uid).sort());
    assert.ok(ui.document.querySelector('#table-loadout [data-slot="0"]').classList.contains('is-triggering'));
    if (id === 'desolator') assert.ok(ui.document.querySelector('#enemy-layer .enemy.marked'), 'The persistent vulnerability status is visible on the marked dish');
    if (id === 'umut') assert.ok(ui.document.querySelector('#enemy-layer .enemy.painted'), 'Umut’s coating is visibly attached to the affected food');
  }
});

test('Beer, Luca and coffee visibly connect their support to the actual benefiting equipment', () => {
  for (const id of ['beer', 'luca', 'kaffee']) {
    const ui = readyCombat(id, 2, run => {
      run.slots[1] = { id: 'headset', level: 1, uid: 'support-headset', invested: 6 };
      run.slots[3] = { id: 'paper', level: 1, uid: 'support-paper', invested: 4 };
      run.slots[4] = { id: 'headset', level: 1, uid: 'diagonal-headset', invested: 6 };
      for (const index of [1, 3, 4]) run.battle.cooldowns[index] = 4;
    });
    ui.step(16);
    const activation = ui.events.find(event => event.type === 'activate' && event.itemId === id);
    assert.ok(activation);
    const kind = id === 'kaffee' ? 'coffee' : id;
    const recipients = id === 'kaffee'
      ? ui.core.getSynergies(ui.live()).filter(synergy => synergy.coffee && synergy.source === 0).flatMap(synergy => synergy.slots.filter(index => index !== 0))
      : Array.from(activation.rechargedSlots || []);
    assert.deepEqual(Array.from(recipients), id === 'luca' ? [1] : [1, 3]);
    const links = ui.document.querySelectorAll(`#combat-fx-layer .support-link[data-kind="${kind}"]`);
    const impacts = ui.document.querySelectorAll(`#combat-fx-layer .support-impact[data-kind="${kind}"]`);
    assert.deepEqual(links.map(node => Number(node.dataset.targetSlot)), Array.from(recipients));
    assert.deepEqual(impacts.map(node => Number(node.dataset.targetSlot)), Array.from(recipients));
    assert.ok(links.every(node => node.dataset.effectRole === 'link'));
    assert.ok(impacts.every(node => node.dataset.effectRole === 'recipient'));
    for (const link of links) assertTableLink(ui, link, 0, Number(link.dataset.targetSlot));
    for (const impact of impacts) assertPoint(effectPoint(impact), tableIconCenter(ui, Number(impact.dataset.targetSlot)), 'Support feedback is attached to the actual item icon');
    for (const index of recipients) assert.ok(ui.document.querySelector(`#table-loadout [data-slot="${index}"]`).classList.contains('is-boosted'));
    assert.equal(ui.document.querySelector('#table-loadout [data-slot="4"]').classList.contains('is-boosted'), false, 'A diagonal item receives neither support nor its highlight');
    assert.equal(ui.events.filter(event => event.type === 'activate').length, 1, 'The animation does not fabricate a recipient activation');
    if (id === 'kaffee') {
      assert.equal(activation.rechargedSlots, undefined, 'Coffee signals its real passive strength bonus without inventing cooldown recharge');
      assert.ok(Math.abs(ui.live().battle.cooldowns[1] - (4 - .016)) < 1e-6);
    }
    if (id === 'beer') {
      ui.resize({ width: 600, stage: { left: 90, top: 70, width: 390, height: 530, border: 3 } });
      ui.step(16);
      for (const link of links) assertTableLink(ui, link, 0, Number(link.dataset.targetSlot));
      const point = effectPoint(links[0]);
      ui.click('pause-button'); ui.advance(1500);
      assert.ok([...links, ...impacts].every(node => node.isConnected), 'Paused support connections keep their remaining visual lifetime');
      assertPoint(effectPoint(links[0]), point, 'The paused connection stays fixed');
      assert.ok(ui.document.querySelector('#table-loadout [data-slot="1"]').classList.contains('is-boosted'), 'The actual recipient highlight also freezes while paused');
      ui.click('serve-button'); ui.advance(1200);
      assert.ok([...links, ...impacts].every(node => !node.isConnected), 'Support feedback cleans up after play resumes');
    }
  }
});

test('passive synergy feedback comes from a real adjacent partner only when its beneficiary activates', () => {
  for (const [id, partner, kind] of [['serviette', 'brotdose', 'power'], ['headset', 'discord', 'cooldown'], ['serviette', 'kaffee', 'coffee']]) {
    for (const partnerSlot of [1, 4]) {
      const ui = readyCombat(id, 1, run => {
        run.slots[partnerSlot] = { id: partner, level: 1, uid: `passive-${partner}`, invested: 6 };
        run.battle.cooldowns[partnerSlot] = 8;
        Object.assign(run.battle.enemies[0], { hp: 1000, maxHp: 1000 });
      });
      ui.step(16);
      const activation = ui.events.find(event => event.type === 'activate');
      assert.equal(activation.itemId, id);
      assert.equal(ui.events.filter(event => event.type === 'activate').length, 1, 'A passive benefit never activates its partner');
      const stats = ui.core.getItemStats(ui.live(), 0);
      assert.equal(activation.power, stats.power);
      assert.equal(activation.cooldown, stats.cooldown);
      const synergies = ui.core.getSynergies(ui.live()).filter(synergy => synergy.slots.includes(0));
      const links = ui.document.querySelectorAll('#combat-fx-layer .synergy-link');
      assert.equal(links.length, synergies.length, 'Only benefits present in the actual rules produce passive connections');
      if (partnerSlot === 1) {
        assert.equal(links.length, 1);
        assert.equal(links[0].dataset.kind, kind);
        assert.equal(links[0].dataset.synergy, synergies[0].name);
        assert.equal(links[0].dataset.effectRole, 'synergy');
        assertTableLink(ui, links[0], 1, 0);
      } else assert.equal(links.length, 0, 'A diagonal partner gives no bonus and draws no connection');
      assert.equal(ui.document.querySelectorAll('#combat-fx-layer .support-link').length, 0, 'An idle passive partner does not pretend to deliver an active support pulse');
    }
  }
});

test('Beer focus stays visible on every gaming item across reload and disappears only when its real attack consumes the bonus', () => {
  for (const id of ['headset', 'discord', 'luca', 'desolator', 'awp', 'batomon']) {
    const first = readyCombat('beer', 1, run => {
      run.slots[1] = { id, level: 1, uid: `focused-${id}`, invested: 6 };
      run.slots[3] = { id: 'paper', level: 1, uid: 'non-gaming-paper', invested: 4 };
      run.slots[4] = { id, level: 1, uid: `diagonal-${id}`, invested: 6 };
      for (const index of [1, 3, 4]) run.battle.cooldowns[index] = 4;
      Object.assign(run.battle.enemies[0], { hp: 1000, maxHp: 1000 });
    });
    first.step(16);
    const chain = first.events.find(event => event.type === 'chain' && event.id === 'beer_focus');
    assert.deepEqual(Array.from(chain.rechargedSlots), [1]);
    assert.equal(first.live().battle.itemRuntime[1].focus, 1);
    assert.ok(first.document.querySelector('#table-loadout [data-slot="1"]').classList.contains('has-focus'));
    for (const index of [0, 3, 4]) assert.equal(first.document.querySelector(`#table-loadout [data-slot="${index}"]`).classList.contains('has-focus'), false, 'Only an adjacent gaming recipient stores the focus bonus');
    first.click('pause-button');
    const ui = mount(first.storage); ui.click('continue-button');
    assert.ok(ui.document.querySelector('#table-loadout [data-slot="1"]').classList.contains('has-focus'), 'Continuing a saved fight restores the real pending bonus');
    ui.advance(1500);
    assert.equal(ui.read().battle.itemRuntime[1].focus, 1, 'Paused time does not consume the bonus');
    ui.click('serve-button'); ui.step(16);
    const expectedPower = ui.core.getItemStats(ui.live(), 1).power * 1.2;
    ui.live().battle.cooldowns.fill(99);
    ui.live().battle.cooldowns[1] = 0;
    ui.step(16);
    const attack = ui.events.find(event => event.type === 'activate' && event.itemId === id);
    assert.ok(attack?.targets.length, 'The bonus is spent by a real attack on food');
    assert.ok(Math.abs(attack.power - expectedPower) < 1e-6);
    assert.equal(ui.live().battle.itemRuntime[1].focus, 0);
    assert.equal(ui.document.querySelector('#table-loadout [data-slot="1"]').classList.contains('has-focus'), false);
    assert.equal(ui.events.filter(event => event.type === 'activate').length, 1, 'Showing and consuming focus adds no extra activation');
  }
});

test('Snus mouth guard is visible, persists, and is consumed by an actual incoming bite', () => {
  const armed = readyCombat('snus', 1);
  armed.tick(2);
  const badge = armed.elements.get('mouth-guard-badge');
  assert.equal(badge.hidden, false);
  assert.match(badge.textContent, /10/);
  armed.click('pause-button');
  assert.equal(armed.read().battle.mouthGuard, 10);
  const restored = mount(armed.storage); restored.click('continue-button');
  assert.equal(restored.elements.get('mouth-guard-badge').hidden, false);
  assert.match(restored.elements.get('mouth-guard-badge').textContent, /10/);
  const hit = readyCombat('snus', 1, run => { run.battle.enemies[0].x = .001; run.battle.enemies[0].speed = .078; });
  hit.tick(2);
  const blocked = hit.events.find(event => event.type === 'guard_block');
  assert.ok(blocked, 'An actual bite consumes the prepared guard');
  assert.ok(blocked.amount > 0);
  assert.equal(hit.elements.get('mouth-guard-badge').hidden, true);
  assert.equal(hit.live().willpower, 100);
});

test('Snus cannot turn an unblocked dessert into a UI victory', () => {
  const ui = readyCombat('snus', 1, (run, core) => {
    Object.assign(run.battle.enemies[0], core.ENEMIES.dessert, {
      type: 'dessert', boss: true, x: .001, hp: 360, maxHp: 360, speed: .078,
    });
  });
  ui.advance(800);
  assert.equal(ui.live().phase, 'lost');
  assert.equal(ui.elements.get('result-dialog').open, true);
  assert.equal(ui.events.some(event => event.type === 'guard_block'), false);
  assert.equal(ui.read().resultRecorded, true);
  assert.equal(ui.elements.get('result-report-button').hidden, false);
  ui.click('result-report-button');
  assert.equal(ui.elements.get('result-dialog').open, false);
  assert.equal(ui.elements.get('battle-report-panel').hidden, false);
  assert.equal(ui.elements.get('report-dialog').open, true);
  assert.equal(ui.isVisible(ui.elements.get('report-body')), true);
  ui.elements.get('report-dialog').close();
  assert.equal(ui.elements.get('result-dialog').open, true, 'Closing a report opened from the result restores that result');
  assert.equal(ui.document.activeElement.id, 'result-report-button');
});

test('old version-two combat saves without the new optional status fields still resume', () => {
  const storage = savedFixture((run, core) => {
    delete run.encounters; // Pre-event saves continue without retroactive interruptions.
    run.coins = 6; // Keep an old saved balance rather than granting the new starting budget.
    core.startBattle(run);
    delete run.battle.mouthGuard;
    delete run.battle.mouthGuardSlot;
    delete run.battle.mouthGuardSource;
    delete run.formationPlan;
    delete run.battle.formationId;
    delete run.battle.enemyTypes;
    delete run.battle.spawnEvery;
    delete run.battle.hpMultiplier;
    delete run.battle.speedMultiplier;
    delete run.battle.cooldownMax;
    delete run.battle.report;
    run.battle.total = core.COURSES[run.course].total;
  });
  const ui = mount(storage);
  assert.equal(ui.elements.get('continue-button').hidden, false);
  ui.click('continue-button');
  assert.equal(ui.elements.get('paused-sticker').hidden, false);
  assert.equal(ui.elements.get('mouth-guard-badge').hidden, true);
  ui.click('serve-button'); ui.tick(20);
  assert.equal(ui.live().phase, 'battle');
  assert.ok(ui.live().battle.time > 0);
  assert.equal(ui.live().coins, 6);
  ui.live().battle.spawned = ui.live().battle.total;
  ui.live().battle.enemies = [];
  ui.advance(800);
  assert.equal(ui.read().phase, 'prep');
  assert.equal(ui.core.getEncounter(ui.read()), null);
  assert.equal(ui.core.getEventBuff(ui.read()), null);
  assert.equal(ui.elements.get('game').dataset.screen, 'shop', 'A legacy save reaches its next shop without receiving a new encounter');
});

test('formation preview announces one deterministic plan with optional enemy details before buying', () => {
  const ui = mount(savedFixture());
  ui.click('continue-button');
  assert.equal(ui.document.activeElement.id, 'screen-title');
  assert.equal(ui.isVisible(ui.document.activeElement), true, 'Continuing preparation focuses its visible screen heading');
  const before = ui.storage.get(saveKey);
  const plan = ui.core.getBattlePlan(ui.read());
  const preview = ui.elements.get('formation-preview');
  assert.equal(preview.hidden, false);
  assert.ok(preview.textContent.includes(plan.formation.name), 'Shop names the actual upcoming formation');
  const details = ui.document.querySelector('#formation-preview details.formation-more');
  assert.equal(details.open, false, 'Only the compact formation summary is shown by default');
  const detailContent = ui.elements.get('notebook-content');
  assert.ok(detailContent.textContent.includes(`${plan.total} GERICHTE`));
  assert.ok(detailContent.textContent.includes(plan.formation.tip));
  for (const type of new Set(plan.enemyTypes)) assert.ok(detailContent.textContent.includes(ui.core.ENEMIES[type].name));
  assert.doesNotMatch(preview.textContent, /undefined|NaN/);
  assert.equal(ui.elements.get('battle-report-panel').hidden, true, 'A new run has no invented combat report');
  const offer = ui.document.querySelector('[data-offer]');
  if (offer) ui.emit('pointerover', { target: offer, relatedTarget: null });
  assert.equal(ui.storage.get(saveKey), before, 'Reading the formation and purchase preview does not consume RNG or save changes');
  details.open = true; // Native disclosure state, independent of the game engine.
  assert.equal(ui.isVisible(detailContent), true);
  ui.select('slot', 0, '#slots');
  assert.equal(details.open, true, 'Inspecting equipment does not collapse an opened enemy plan');
  assert.equal(ui.storage.get(saveKey), before, 'Opening help and selecting an item leave the announced plan unchanged');
  const restored = mount(ui.storage); restored.click('continue-button');
  assert.equal(restored.elements.get('formation-preview').textContent, preview.textContent, 'Reload preserves the announced plan');
});

test('all four tactical items expose two accessible choices that persist and follow the item', () => {
  const choices = { awp: ['threat', 'marked'], batomon: ['green', 'cleanup'], desolator: ['front', 'armored'], luca: ['strongest', 'longest'] };
  for (const [id, ids] of Object.entries(choices)) {
    const ui = mount(savedFixture(run => { run.slots[1] = { id, level: 1, uid: `tactic-${id}`, invested: 0 }; }));
    ui.click('continue-button');
    ui.select('slot', 1, '#slots');
    const controls = ui.document.querySelectorAll('#item-detail [data-tactic]');
    assert.equal(controls.length, 2, `${id} has exactly two choices`);
    assert.deepEqual(controls.map(button => button.dataset.tactic), ids);
    for (const button of controls) {
      assert.equal(button.tagName, 'BUTTON', 'Choices use native keyboard-operable buttons');
      assert.equal(button.disabled, false);
      assert.equal(button.dataset.tacticSlot, '1');
      assert.ok(button.textContent.trim().length > 0);
    }
    const changed = controls.find(button => button.dataset.tactic === ids[1]);
    changed.focus();
    ui.emit('click', { target: changed });
    assert.equal(ui.read().slots[1].tactic, ids[1], `${id} saves the actual engine tactic`);
    assert.equal(ui.document.querySelector(`#item-detail [data-tactic="${ids[1]}"]`).getAttribute('aria-pressed'), 'true');
    assert.equal(ui.document.activeElement.dataset.tactic, ids[1], 'Changing tactics retains useful keyboard focus');
    const equippedBefore = JSON.stringify(ui.read().slots);
    const target = ui.document.querySelector('#slots [data-slot="1"]');
    ui.emit('pointerover', { target, relatedTarget: null });
    assert.ok(ui.elements.get('item-tooltip').textContent.includes(ui.core.getTactic(ui.read(), 1).label), 'Help exposes the chosen tactic');
    assert.equal(JSON.stringify(ui.read().slots), equippedBefore, 'Inspecting a tactic does not move the item');
    const restored = mount(ui.storage); restored.click('continue-button');
    assert.equal(restored.read().slots[1].tactic, ids[1]);
    restored.select('slot', 1, '#slots'); restored.select('slot', 2, '#slots');
    assert.equal(restored.read().slots[2].uid, `tactic-${id}`);
    assert.equal(restored.read().slots[2].tactic, ids[1], 'Tactic follows the item when it moves');
  }
});

test('reserve tactics persist while the combat screen exposes the prepared tactic without editing controls', () => {
  const ui = mount(savedFixture(run => {
    run.slots[1] = { id: 'awp', level: 1, uid: 'locked-awp', invested: 9, tactic: 'marked' };
    run.bench = [{ id: 'luca', level: 1, uid: 'reserve-luca', invested: 6 }];
  }));
  ui.click('continue-button'); ui.select('slot', 6, '#bench');
  ui.select('tactic', 'longest');
  assert.equal(ui.read().bench[0].tactic, 'longest');
  ui.select('slot', 6, '#bench'); // Deselect the reserve before serving.
  ui.click('shop-serve-button');
  assert.equal(ui.elements.get('shop-screen').hidden, true);
  assert.equal(ui.isVisible(ui.elements.get('loadout-panel')), false);
  assert.equal(ui.isVisible(ui.elements.get('item-detail')), false);
  const target = ui.document.querySelector('#table-loadout [data-slot="1"]');
  ui.emit('pointerover', { target, relatedTarget: null });
  assert.match(ui.elements.get('item-tooltip').textContent, /Markierte Ziele/);
  assert.equal(ui.read().slots[1].tactic, 'marked');
  const before = ui.storage.get(saveKey);
  ui.emit('click', { target: { closest: selector => selector === '[data-tactic]' ? { dataset: { tacticSlot: '1', tactic: 'threat' } } : null } });
  assert.equal(ui.read().slots[1].tactic, 'marked');
  assert.equal(ui.storage.get(saveKey), before, 'The tactic handler also rejects a synthetic battle edit');
});

test('an actual Snus block displays its Beer chain and highlights the recharged neighbor', () => {
  const ui = readyCombat('snus', 1, run => {
    run.slots[1] = { id: 'beer', level: 1, uid: 'chain-beer', invested: 4 };
    run.battle.cooldowns[1] = 5;
    run.battle.enemies[0].x = .001;
    run.battle.enemies[0].speed = .078;
  });
  ui.tick(2);
  const chain = ui.events.find(event => event.type === 'chain' && event.id === 'snus_beer');
  assert.ok(chain, 'The notice is backed by an actual rule event');
  assert.ok(chain.rechargedSlots.includes(1));
  const link = ui.document.querySelector('#combat-fx-layer .chain-link[data-chain="snus_beer"]');
  assertTableLink(ui, link, chain.sourceSlot, 1);
  const impact = ui.document.querySelector('#combat-fx-layer .chain-impact[data-chain="snus_beer"]');
  assertPoint(effectPoint(impact), tableIconCenter(ui, 1), 'The Snus reaction reaches the beer that was actually recharged');
  const feed = ui.elements.get('chain-feed');
  assert.ok(feed.textContent.includes(chain.name));
  assert.ok(ui.document.querySelector('#table-loadout [data-slot="1"]').classList.contains('is-boosted'));
  assert.ok(ui.document.querySelector('#combat-fx-layer .chain-burst'), 'The chain also has a visible origin on the table');
  assert.doesNotMatch(feed.textContent, /undefined|NaN/);
});

test('an AWP marked kill visibly feeds the neighboring Luca without inventing a second activation', async () => {
  const ui = readyCombat('awp', 1, run => {
    run.slots[1] = { id: 'luca', level: 1, uid: 'chain-luca', invested: 6 };
    run.battle.cooldowns[1] = 5;
    Object.assign(run.battle.enemies[0], { hp: 10, vulnerableUntil: 99 });
  }, { audioSpy: true });
  await enableTestSound(ui);
  ui.step(16);
  const chain = ui.events.find(event => event.type === 'chain' && event.id === 'marked_finish');
  assert.ok(chain);
  assert.equal(acceptedSounds(ui, 'chain').length, 0, 'The marked-kill chain is silent until its triggering hit arrives');
  assert.equal(ui.document.querySelector('#combat-fx-layer .chain-link[data-chain="marked_finish"]'), null, 'A marked finish is not shown before its shot reaches the food');
  const projectile = ui.document.querySelector('#combat-fx-layer .item-projectile[data-slot="0"]');
  waitForProjectileArrival(ui, projectile);
  assert.equal(acceptedSounds(ui, 'chain').length, 1);
  assert.equal(acceptedSounds(ui, 'chain')[0].options.chainId, 'marked_finish');
  const link = ui.document.querySelector('#combat-fx-layer .chain-link[data-chain="marked_finish"]');
  assertTableLink(ui, link, chain.sourceSlot, 1);
  assert.ok(ui.elements.get('chain-feed').textContent.includes(chain.name));
  assert.ok(ui.document.querySelector('#table-loadout [data-slot="1"]').classList.contains('is-boosted'));
  assert.equal(ui.events.filter(event => event.type === 'activate' && event.itemId === 'luca').length, 0, 'Reaction advances cooldown rather than fabricating an ordinary activation');
  assert.equal(ui.document.querySelectorAll('#combat-fx-layer [data-effect-role="source"]').length, 1, 'One normal AWP shot retains one source activation');
});

test('a completed battle keeps detailed statistics in an opt-in dialog across closing and reload', () => {
  const ui = mount(savedFixture((run, core) => {
    run.slots = [{ id: 'serviette', level: 1, uid: 'report-napkin', invested: 0 }, null, null, null, null, null];
    core.startBattle(run);
    run.battle.spawned = run.battle.total;
    run.battle.nextSpawn = 999;
    run.battle.cooldowns[0] = 0;
    run.battle.enemies = [{ ...core.ENEMIES.erbsen, type: 'erbsen', uid: 'report-enemy', lane: 0, x: .5,
      hp: 7, maxHp: 7, shield: 0, maxShield: 0, speed: 0, slowUntil: 0 }];
  }));
  ui.click('continue-button'); ui.click('serve-button'); ui.advance(800);
  assert.equal(ui.read().phase, 'prep');
  const report = ui.core.getBattleReport(ui.read());
  assert.ok(report);
  const item = report.items.find(entry => entry.uid === 'report-napkin');
  assert.equal(item.damage, 7);
  assert.equal(item.kills, 1);
  assert.ok(item.overkill > 0);
  assert.equal(ui.core.getEncounter(ui.read()), null, 'The first clear opens the shop directly');
  assert.equal(ui.elements.get('shop-screen').hidden, false);
  assert.equal(ui.elements.get('battle-screen').hidden, true);
  assert.equal(ui.elements.get('round-recap').hidden, false);
  assert.equal(ui.elements.get('report-dialog').open, false, 'Statistics never open automatically after a round');
  assert.equal(ui.isVisible(ui.elements.get('report-body')), false, 'No full stat table occupies the shop screen');
  ui.elements.get('report-toggle').focus();
  ui.click('report-toggle');
  assert.equal(ui.elements.get('report-dialog').open, true);
  const panel = ui.elements.get('battle-report-panel');
  assert.equal(panel.hidden, false);
  assert.ok(panel.textContent.includes(report.formationName));
  const row = ui.document.querySelector('[data-report-item="report-napkin"]');
  assert.ok(row, 'Each actual contribution is tied to the original item UID');
  assert.ok(row.textContent.includes(ui.core.ITEMS.serviette.name));
  const cells = row.querySelectorAll('td');
  const number = value => Number(value.toFixed(1)).toLocaleString('de-DE');
  assert.equal(cells[0].textContent, String(item.activations));
  assert.equal(cells[1].textContent, number(item.damage));
  assert.equal(cells[2].textContent, number(item.overkill));
  assert.equal(cells[3].textContent, String(item.kills));
  assert.equal(cells[4].textContent, `${number(item.shield)} / ${number(item.blocked)}`);
  assert.equal(cells[5].textContent, `${number(item.recharge)} s`);
  assert.equal(cells[6].textContent, `${number(item.idleTime)} s`);
  assert.doesNotMatch(panel.textContent, /undefined|NaN/);
  assert.equal(ui.isVisible(ui.elements.get('report-body')), true);
  ui.emit('click', { target: ui.elements.get('report-dialog').querySelector('[data-close-dialog]') });
  assert.equal(ui.elements.get('report-dialog').open, false);
  assert.equal(ui.isVisible(ui.elements.get('report-body')), false);
  assert.equal(ui.document.activeElement.id, 'report-toggle', 'Closing the report restores its compact opener');
  ui.click('report-toggle');
  assert.equal(ui.elements.get('report-dialog').open, true);
  ui.elements.get('report-dialog').close(); // Native Escape/scrim dismissal takes the same close-event path.
  assert.equal(ui.elements.get('report-dialog').open, false);
  assert.equal(ui.document.activeElement.id, 'report-toggle');
  const restored = mount(ui.storage); restored.click('continue-button');
  assert.equal(restored.elements.get('report-dialog').open, false, 'Restoring a run does not reopen the large report');
  assert.equal(restored.elements.get('round-recap').hidden, false);
  restored.click('report-toggle');
  assert.equal(restored.elements.get('battle-report-panel').hidden, false);
  assert.ok(restored.document.querySelector('[data-report-item="report-napkin"]'));
  assert.deepEqual(JSON.parse(JSON.stringify(restored.core.getBattleReport(restored.read()))), JSON.parse(JSON.stringify(report)), 'Reload keeps the actual completed report snapshot across browser contexts');
});

test('the report identifies the actual leaked dish and lost willpower', () => {
  const ui = mount(savedFixture((run, core) => {
    run.slots = [{ id: 'paper', level: 1, uid: 'late-paper', invested: 0 }, null, null, null, null, null];
    core.startBattle(run);
    run.battle.cooldowns[0] = 999;
    run.battle.spawned = run.battle.total;
    run.battle.nextSpawn = 999;
    run.battle.enemies = [{ ...core.ENEMIES.pasta, type: 'pasta', uid: 'leaked-pasta', lane: 1, x: .001,
      hp: 45, maxHp: 45, shield: 0, maxShield: 0, speed: .078, slowUntil: 0 }];
  }));
  ui.click('continue-button'); ui.click('serve-button'); ui.advance(800);
  const report = ui.core.getBattleReport(ui.read());
  assert.ok(report);
  assert.equal(report.escaped, 1);
  assert.equal(report.damageTaken, 13);
  assert.equal(report.willpowerStart - report.willpowerEnd, 13);
  assert.equal(report.leaks[0].type, 'pasta');
  assert.equal(report.leaks[0].count, 1);
  assert.equal(ui.elements.get('report-dialog').open, false);
  assert.equal(ui.elements.get('game').dataset.screen, 'shop', 'The first clear leaves the report accessible directly from the shop');
  ui.click('report-toggle');
  const panel = ui.elements.get('battle-report-panel');
  assert.equal(panel.hidden, false);
  assert.ok(panel.textContent.includes(ui.core.ENEMIES.pasta.name));
  assert.match(panel.textContent, /13/);
});

test('AWP magazine and Luca momentum badges reflect the running automatic combat state', () => {
  const awp = readyCombat('awp', 1, run => {
    Object.assign(run.battle.enemies[0], { hp: 1000, maxHp: 1000 });
  });
  awp.tick(2);
  let badge = awp.document.querySelector('#table-loadout [data-slot="0"] .runtime-badge');
  assert.equal(badge.textContent, '1/2');
  awp.tick(14);
  assert.equal(awp.events.filter(event => event.type === 'activate' && event.itemId === 'awp').length, 2);
  assert.equal(badge.textContent, '0/2', 'The second shot starts the long reload phase');
  assert.equal(awp.live().battle.cooldownMax[0], awp.core.getItemStats(awp.live(), 0).cooldown);
  const progress = awp.document.querySelector('#table-loadout [data-slot="0"] .table-item-progress');
  assert.ok(parseFloat(progress.style.width) < 20, 'Reload progress uses the long phase duration instead of the one-second shot interval');

  const luca = readyCombat('luca', 1);
  luca.tick(2);
  for (let activation = 0; activation < 2; activation++) {
    luca.live().battle.cooldowns[0] = 0;
    luca.tick(2);
  }
  const rhythm = luca.events.find(event => event.type === 'chain' && event.id === 'gaming_rhythm');
  assert.ok(rhythm, 'Three real normal activations build a momentum step');
  badge = luca.document.querySelector('#table-loadout [data-slot="0"] .runtime-badge');
  assert.equal(badge.textContent, '+10 %');
  assert.ok(luca.elements.get('chain-feed').textContent.includes(rhythm.name));
  luca.click('pause-button');
  const restored = mount(luca.storage); restored.click('continue-button');
  assert.equal(restored.document.querySelector('#table-loadout [data-slot="0"] .runtime-badge').textContent, '+10 %', 'A saved mid-battle momentum stack remains visible after resuming');
});

test('support soup is labeled and an actual heal visibly marks the healed dish', () => {
  const ui = readyCombat('paper', 2, (run, core) => {
    run.battle.cooldowns[0] = 999;
    Object.assign(run.battle.enemies[0], core.ENEMIES.suppe, {
      type: 'suppe', support: true, nextHeal: 0, hp: 100, maxHp: 100, speed: 0,
    });
    Object.assign(run.battle.enemies[1], { hp: 40, maxHp: 100 });
  });
  ui.tick(2);
  const heal = ui.events.find(event => event.type === 'enemy_heal');
  assert.ok(heal);
  assert.equal(heal.amount, 6);
  const soup = ui.document.querySelector('#enemy-layer .enemy.support');
  assert.ok(soup);
  assert.match(soup.querySelector('.enemy-role').textContent, /HEILT/);
  assert.equal(heal.enemyUid, 'test-enemy-1');
  const healed = ui.document.querySelector('#enemy-layer .enemy.healing');
  assert.ok(healed, 'The actual restored dish receives a healing pulse');
  assert.equal(healed.querySelector('.enemy-name').textContent, ui.core.ENEMIES.erbsen.name, 'The pulse belongs to the restored green dish');
  assert.equal(soup.classList.contains('healing'), false, 'The healer is not falsely shown as the healed target');
  assert.match(ui.elements.get('effect-layer').textContent, /\+6/);
});

test('preparation opens one compact shop screen with optional details and no battle or report competing for space', () => {
  const ui = mount();
  ui.click('new-run-button');
  assert.equal(ui.elements.get('game').dataset.screen, 'shop');
  assert.equal(ui.elements.get('shop-screen').hidden, false);
  assert.equal(ui.elements.get('battle-screen').hidden, true);
  assert.equal(ui.isVisible(ui.elements.get('shop-panel')), true);
  assert.equal(ui.isVisible(ui.elements.get('loadout-panel')), true);
  assert.equal(ui.isVisible(ui.elements.get('battle-stage')), false);
  assert.equal(ui.document.querySelectorAll('#shop-screen [data-offer]').length, 4);
  assert.equal(ui.document.querySelectorAll('#shop-screen #slots [data-slot]').length, 6);
  assert.equal(ui.isVisible(ui.elements.get('item-detail')), false, 'No placeholder detail card consumes room without a selection');
  assert.equal(ui.elements.get('round-recap').hidden, true);
  assert.equal(ui.elements.get('report-dialog').open, false);
  assert.equal(ui.isVisible(ui.elements.get('report-body')), false);
  assert.match(ui.elements.get('prep-willpower').textContent, /100/);
  assert.equal(ui.document.body.classList.contains('playing'), true);
  const formationDetails = ui.document.querySelector('#shop-screen details.formation-more');
  assert.ok(formationDetails);
  assert.equal(formationDetails.open, false, 'The full enemy plan is available on demand');
  assert.equal(ui.isVisible(ui.elements.get('notebook-content')), false);
  const combinations = ui.document.querySelector('#shop-screen details.loadout-synergies');
  assert.ok(combinations);
  assert.equal(combinations.open, false, 'Long combination explanations start folded');
  assert.equal(ui.document.querySelectorAll('#shop-screen .wallet').length, 0, 'Currency is shown once in the shared status bar');
});

test('serving replaces the shop with the focused battle screen and preserves that screen on pause and resume', () => {
  const ui = mount();
  ui.click('new-run-button');
  const before = ui.read().slots;
  ui.click('shop-serve-button');
  assert.equal(ui.elements.get('game').dataset.screen, 'battle');
  assert.equal(ui.elements.get('shop-screen').hidden, true);
  assert.equal(ui.elements.get('battle-screen').hidden, false);
  assert.equal(ui.isVisible(ui.elements.get('battle-stage')), true);
  assert.equal(ui.isVisible(ui.elements.get('shop-panel')), false);
  assert.equal(ui.isVisible(ui.elements.get('loadout-panel')), false);
  assert.equal(ui.isVisible(ui.elements.get('shop-serve-button')), false);
  assert.equal(ui.isVisible(ui.elements.get('sell-zone')), false);
  assert.equal(ui.isVisible(ui.elements.get('pause-button')), true);
  assert.equal(ui.isVisible(ui.elements.get('speed-button')), true);
  assert.equal(ui.isVisible(ui.elements.get('report-body')), false);
  assert.deepEqual(ui.read().slots, before, 'Changing screens does not alter the prepared equipment');
  assertTableMatchesInventory(ui);
  ui.tick(12);
  ui.click('pause-button');
  assert.equal(ui.elements.get('game').dataset.screen, 'battle');
  assert.equal(ui.elements.get('paused-sticker').hidden, false);
  ui.click('home-button');
  assert.equal(ui.document.body.classList.contains('playing'), false);
  const restored = mount(ui.storage); restored.click('continue-button');
  assert.equal(restored.elements.get('game').dataset.screen, 'battle');
  assert.equal(restored.elements.get('shop-screen').hidden, true);
  assert.equal(restored.elements.get('paused-sticker').hidden, false);
  assert.equal(restored.elements.get('report-dialog').open, false);
  restored.click('serve-button');
  assert.equal(restored.elements.get('paused-sticker').hidden, true);
});

test('selecting shop equipment reveals its focused controls without unfolding all help', () => {
  const ui = mount(savedFixture(run => {
    run.slots[1] = { id: 'awp', level: 1, uid: 'compact-awp', invested: 9, tactic: 'marked' };
  }));
  ui.click('continue-button');
  assert.equal(ui.elements.get('item-detail').hidden, true);
  ui.select('slot', 1, '#slots');
  assert.equal(ui.elements.get('item-detail').hidden, false);
  assert.match(ui.elements.get('item-detail').textContent, /AWP/);
  assert.equal(ui.document.querySelectorAll('#item-detail [data-tactic]').length, 2);
  assert.equal(ui.isVisible(ui.document.querySelector('#item-detail [data-tactic="marked"]')), true);
  const effect = ui.document.querySelector('#item-detail details.item-more');
  assert.ok(effect);
  assert.equal(effect.open, false, 'Full effect text is available without dominating selected-item controls');
  assert.equal(ui.isVisible(ui.document.querySelector('#sell-zone [data-sell="1"]')), true);
  ui.select('slot', 1, '#slots');
  assert.equal(ui.elements.get('item-detail').hidden, true, 'Deselecting returns the room to the preparation controls');
});

function combatLocalCenter(ui, node) {
  const rect = node.getBoundingClientRect();
  const layer = ui.elements.get('combat-fx-layer').getBoundingClientRect();
  return { x: rect.left + rect.width / 2 - layer.left, y: rect.top + rect.height / 2 - layer.top };
}

function assertPoint(actual, expected, message, tolerance = .1) {
  assert.ok(Number.isFinite(actual.x) && Number.isFinite(actual.y), `${message}: both coordinates must be finite`);
  assert.ok(Math.abs(actual.x - expected.x) <= tolerance, `${message}: x ${actual.x} should match ${expected.x}`);
  assert.ok(Math.abs(actual.y - expected.y) <= tolerance, `${message}: y ${actual.y} should match ${expected.y}`);
}

function flightPoint(node, name) {
  return { x: parseFloat(node.style.getPropertyValue(`--${name}-x`)), y: parseFloat(node.style.getPropertyValue(`--${name}-y`)) };
}

function effectPoint(node) { return { x: parseFloat(node.style.left), y: parseFloat(node.style.top) }; }

function enemyHealthPercent(node) {
  assert.ok(node?.isConnected, 'The pending food remains visible until its confirmed impacts');
  const value = parseFloat(node.querySelector('.enemy-health>i').style.width);
  assert.ok(Number.isFinite(value) && value >= 0 && value <= 100, 'The displayed food health is a bounded percentage');
  return value;
}

function tableIconCenter(ui, index) {
  return combatLocalCenter(ui, ui.document.querySelector(`#table-loadout [data-slot="${index}"] .table-item-icon`));
}

function assertTableLink(ui, link, sourceSlot, targetSlot) {
  assert.ok(link, 'The actual table connection exists');
  assert.equal(Number(link.dataset.sourceSlot), sourceSlot);
  assert.equal(Number(link.dataset.targetSlot), targetSlot);
  const source = tableIconCenter(ui, sourceSlot);
  const target = tableIconCenter(ui, targetSlot);
  assertPoint(effectPoint(link), source, 'The connection starts at its actual source icon');
  const angle = parseFloat(link.style.getPropertyValue('--flight-angle')) * Math.PI / 180;
  const length = parseFloat(link.style.width);
  assertPoint({ x: source.x + Math.cos(angle) * length, y: source.y + Math.sin(angle) * length }, target, 'The connection reaches its actual recipient icon');
}

function waitForProjectileArrival(ui, projectile) {
  let frames = 0;
  while (projectile.isConnected && frames++ < 80) ui.step(8);
  assert.ok(frames < 80, 'A projectile reaches its destination within its bounded travel time');
  const impact = ui.document.querySelector(`#combat-fx-layer .target-impact[data-enemy-uid="${projectile.dataset.enemyUid}"]`);
  assert.ok(impact, 'The arrived projectile produces its associated target impact');
  return impact;
}

test('projectiles aim at the rendered normal and boss icon centers in the effect layer coordinate system', () => {
  for (const boss of [false, true]) {
    const ui = readyCombat('serviette', 1, (run, core) => {
      if (boss) Object.assign(run.battle.enemies[0], core.ENEMIES.dessert, { type: 'dessert', boss: true });
      Object.assign(run.battle.enemies[0], { hp: 1000, maxHp: 1000, speed: 0 });
    });
    const icon = ui.document.querySelector('#enemy-layer .enemy-icon');
    if (boss) icon.rectOverride = () => {
      const enemy = icon.parentElement.getBoundingClientRect();
      return { left: enemy.left + 4, top: enemy.top + 3, width: enemy.width - 2, height: 63 };
    }; // Glyph/layout differences must be measured, not reconstructed from enemy.x alone.
    const anchor = combatLocalCenter(ui, icon.parentElement);
    const expected = combatLocalCenter(ui, icon);
    assert.ok(Math.abs(anchor.y - expected.y) > 4, 'The fixture distinguishes the food icon from its container anchor');
    ui.step(16);
    const projectile = ui.document.querySelector('#combat-fx-layer .item-projectile[data-enemy-uid="test-enemy-0"]');
    assert.ok(projectile);
    assert.equal(projectile.dataset.state, 'flying');
    assert.equal(projectile.dataset.slot, '0');
    assert.equal(Number(projectile.dataset.elapsed), 0, 'A new projectile is visible at its source in the launch frame');
    assertPoint(flightPoint(projectile, 'target'), expected, `${boss ? 'Boss' : 'Normal'} target uses the actual icon center`);
    assertPoint(flightPoint(projectile, 'start'), combatLocalCenter(ui, ui.document.querySelector('#table-loadout [data-slot="0"]')), 'Source uses the same content origin as the target');
    assert.equal(ui.document.querySelector('#combat-fx-layer .target-impact'), null);
    assert.equal(ui.document.querySelectorAll('#battle-stage .floating-effect').length, 0, 'Damage is not drawn before travel finishes');
    const impact = waitForProjectileArrival(ui, projectile);
    assertPoint(effectPoint(impact), combatLocalCenter(ui, icon), 'Arrival lands on the visible food');
    assert.ok(ui.document.querySelectorAll('#battle-stage .floating-effect').some(node => /^−\d/.test(node.textContent)), 'Actual damage is drawn when the shot arrives');
  }
});

test('moving food remains the exact projectile destination at normal speed, triple speed and after resize', () => {
  const travelTimes = [];
  for (const scenario of [{ speed: 1 }, { speed: 3 }, { speed: 1, resize: true }]) {
    const ui = readyCombat('serviette', 1, run => { Object.assign(run.battle.enemies[0], { hp: 1000, maxHp: 1000, speed: .16, x: .9 }); });
    if (scenario.speed === 3) { ui.click('speed-button'); ui.click('speed-button'); }
    ui.step(16);
    const projectile = ui.document.querySelector('#combat-fx-layer .item-projectile[data-enemy-uid="test-enemy-0"]');
    const icon = ui.document.querySelector('#enemy-layer .enemy-icon');
    assert.ok(projectile);
    const launchTarget = flightPoint(projectile, 'target');
    const launchedAt = ui.now();
    const duration = Number(projectile.dataset.duration);
    assert.ok(duration >= .1 && duration <= .28, 'Travel duration stays in the readable simulated-time interval');
    ui.step(16);
    assertPoint(flightPoint(projectile, 'target'), combatLocalCenter(ui, icon), 'The destination follows food movement rather than its attack snapshot');
    assert.ok(Math.abs(flightPoint(projectile, 'target').x - launchTarget.x) > .2, 'The target actually moved while the shot was in flight');
    if (scenario.resize) {
      ui.resize({ width: 390, height: 844, stage: { left: 19, top: 180, width: 352, height: 360, border: 3 } });
      ui.step(8);
      assertPoint(flightPoint(projectile, 'target'), combatLocalCenter(ui, icon), 'An in-flight shot remeasures the resized mobile field');
    }
    const impact = waitForProjectileArrival(ui, projectile);
    assertPoint(effectPoint(impact), combatLocalCenter(ui, icon), `The moving target is hit exactly at ${scenario.speed}×${scenario.resize ? ' after resize' : ''}`);
    assert.equal(projectile.isConnected, false);
    assert.equal(ui.events.filter(event => event.type === 'activate').length, 1, 'Flight checks do not create additional activations');
    if (!scenario.resize) travelTimes.push(ui.now() - launchedAt);
  }
  assert.ok(travelTimes[1] < travelTimes[0] * .5, 'Triple speed accelerates visible travel along with combat');
});

test('short flights arrive sooner than long flights without showing early impacts', () => {
  const durations = [];
  for (const x of [.04, 1]) {
    const ui = readyCombat('serviette', 1, run => { Object.assign(run.battle.enemies[0], { hp: 1000, maxHp: 1000, x, speed: 0 }); });
    ui.step(16);
    const projectile = ui.document.querySelector('#combat-fx-layer .item-projectile[data-enemy-uid="test-enemy-0"]');
    assert.ok(projectile);
    durations.push(Number(projectile.dataset.duration));
    assert.equal(ui.document.querySelector('#combat-fx-layer .target-impact'), null);
    waitForProjectileArrival(ui, projectile);
  }
  assert.ok(durations[0] < durations[1], 'Distance affects travel time instead of using one long animation for every shot');
});

test('Brotdose visibly packs the actual food from its icon into the box and keeps a lethal target until arrival', () => {
  const ui = readyCombat('brotdose', 1, run => { Object.assign(run.battle.enemies[0], { hp: 20, maxHp: 20, speed: .1 }); });
  ui.step(16);
  const projectile = ui.document.querySelector('#combat-fx-layer .item-projectile[data-enemy-uid="test-enemy-0"]');
  const food = ui.document.querySelector('#enemy-layer .enemy');
  const icon = food?.querySelector('.enemy-icon');
  const box = ui.document.querySelector('#table-loadout [data-slot="0"]');
  assert.ok(projectile && food && icon);
  assert.ok(ui.events.some(event => event.type === 'kill'), 'This is an actual lethal pack action');
  assert.equal(ui.live().battle.enemies.length, 0, 'The rules have already removed the packed portion');
  assertPoint(flightPoint(projectile, 'start'), combatLocalCenter(ui, icon), 'Packing begins at the rendered food icon');
  assertPoint(flightPoint(projectile, 'target'), combatLocalCenter(ui, box), 'Packing travels toward the actual box');
  const frozen = icon.getBoundingClientRect();
  ui.step(40);
  assert.ok(food.isConnected, 'The packed food remains visible before the reverse flight arrives');
  assert.equal(icon.getBoundingClientRect().left, frozen.left, 'A logically removed target stays frozen rather than drifting away from its shot');
  const impact = waitForProjectileArrival(ui, projectile);
  assertPoint(effectPoint(impact), combatLocalCenter(ui, box), 'The reverse flight lands and flashes at the box');
  assert.equal(impact.dataset.enemyUid, 'test-enemy-0', 'Reverse flight arrival still identifies the affected food');
  ui.advance(320);
  assert.equal(food.isConnected, false, 'The packed portion fades only after the visible action completes');
});

test('pausing freezes in-flight position and delays impact until combat resumes', () => {
  const ui = readyCombat('serviette', 1, run => { Object.assign(run.battle.enemies[0], { hp: 1000, maxHp: 1000, x: .95, speed: .15 }); });
  ui.step(16);
  ui.step(32);
  const projectile = ui.document.querySelector('#combat-fx-layer .item-projectile[data-enemy-uid="test-enemy-0"]');
  assert.ok(projectile);
  const point = effectPoint(projectile);
  const elapsed = Number(projectile.dataset.elapsed);
  ui.click('pause-button');
  ui.advance(1200);
  assert.ok(projectile.isConnected, 'Real time passing does not discard a paused shot');
  assertPoint(effectPoint(projectile), point, 'Paused flight remains fixed');
  assert.equal(Number(projectile.dataset.elapsed), elapsed);
  assert.equal(ui.document.querySelector('#combat-fx-layer .target-impact'), null);
  assert.equal(ui.document.querySelectorAll('#battle-stage .floating-effect').length, 0);
  ui.click('serve-button');
  const impact = waitForProjectileArrival(ui, projectile);
  assertPoint(effectPoint(impact), combatLocalCenter(ui, ui.document.querySelector('#enemy-layer .enemy-icon')), 'The resumed shot reaches the current food center');
  const damageNumber = ui.document.querySelectorAll('#battle-stage .floating-effect').find(node => /^−\d/.test(node.textContent));
  assert.ok(damageNumber, 'The arrived shot creates its actual damage number');
  const impactAtPause = effectPoint(impact);
  const numberAtPause = effectPoint(damageNumber);
  const damageText = damageNumber.textContent;
  ui.click('pause-button');
  ui.advance(1500);
  assert.ok(impact.isConnected, 'A completed impact remains visible while paused beyond its normal lifetime');
  assert.ok(damageNumber.isConnected, 'Its damage number is not removed by real-time timers during pause');
  assertPoint(effectPoint(impact), impactAtPause, 'Paused impact stays fixed');
  assertPoint(effectPoint(damageNumber), numberAtPause, 'Paused damage feedback stays fixed');
  assert.equal(damageNumber.textContent, damageText);
  ui.click('serve-button');
  ui.advance(1100);
  assert.equal(impact.isConnected, false, 'Impact lifetime resumes and cleans up after play continues');
  assert.equal(damageNumber.isConnected, false, 'Damage feedback also cleans up after its remaining active lifetime');
});

test('AWP tracer appears on arrival and joins the exact item and moving food centers', () => {
  const ui = readyCombat('awp', 1, run => { Object.assign(run.battle.enemies[0], { hp: 1000, maxHp: 1000, speed: .12, x: .8 }); });
  ui.step(16);
  const projectile = ui.document.querySelector('#combat-fx-layer .item-projectile[data-enemy-uid="test-enemy-0"]');
  assert.ok(projectile);
  assert.equal(ui.document.querySelector('#combat-fx-layer .snipe-tracer'), null, 'A tracer does not flash at an old target position before arrival');
  const impact = waitForProjectileArrival(ui, projectile);
  const tracer = ui.document.querySelector('#combat-fx-layer .snipe-tracer');
  assert.ok(tracer);
  const source = combatLocalCenter(ui, ui.document.querySelector('#table-loadout [data-slot="0"]'));
  assertPoint(effectPoint(tracer), source, 'The AWP line starts at the item');
  const angle = parseFloat(tracer.style.getPropertyValue('--flight-angle')) * Math.PI / 180;
  const length = parseFloat(tracer.style.width);
  assertPoint({ x: source.x + Math.cos(angle) * length, y: source.y + Math.sin(angle) * length }, effectPoint(impact), 'The AWP line ends at its actual impact');
});

test('lethal flights never refill wounded food while other dishes live, including simultaneous shots at triple speed', () => {
  for (const [speed, shots] of [[1, 1], [1, 2], [3, 2]]) {
    const ui = readyCombat('serviette', 2, run => {
      if (shots === 2) {
        run.slots[1] = { id: 'serviette', level: 1, uid: 'second-napkin', invested: 4 };
        run.battle.cooldowns[1] = 0;
      }
      Object.assign(run.battle.enemies[0], { hp: shots === 1 ? 7 : 25, maxHp: 100, x: .82, speed: 0 });
      Object.assign(run.battle.enemies[1], { hp: 1000, maxHp: 1000, x: .95, speed: 0 });
    });
    if (speed === 3) { ui.click('speed-button'); ui.click('speed-button'); }
    const uid = 'test-enemy-0';
    const findFood = () => ui.document.querySelector(`#enemy-layer .enemy[data-enemy-uid="${uid}"]`);
    let health = enemyHealthPercent(findFood());
    assert.ok(Math.abs(health - (shots === 1 ? 7 : 25)) < 1e-8);
    ui.step(16);
    assert.ok(ui.events.some(event => event.type === 'kill' && event.enemyUid === uid));
    assert.equal(ui.live().phase, 'battle', 'Another living dish keeps this out of the end-of-battle drain');
    const flights = ui.document.querySelectorAll(`#combat-fx-layer .item-projectile[data-enemy-uid="${uid}"]`);
    assert.equal(flights.length, shots, 'Each real activation targets the wounded dish before its death');
    const observe = () => {
      const next = enemyHealthPercent(findFood());
      assert.ok(next <= health + 1e-8, `Killed food health must not rise from ${health}% to ${next}% at ${speed}×`);
      health = next;
      for (const flight of flights.filter(node => node.isConnected)) assertPoint(flightPoint(flight, 'target'), combatLocalCenter(ui, findFood().querySelector('.enemy-icon')), 'Every pending shot keeps the retained food as its exact destination');
    };
    observe();
    ui.click('pause-button'); ui.advance(1200); observe();
    assert.ok(flights.every(node => node.isConnected), 'Pause retains pending shots and their dead target without showing an early hit');
    ui.click('serve-button');
    let frames = 0;
    while (flights.some(node => node.isConnected) && frames++ < 80) { ui.step(8); observe(); }
    assert.ok(frames < 80);
    assert.equal(health, 0);
    const impacts = ui.document.querySelectorAll(`#combat-fx-layer .target-impact[data-enemy-uid="${uid}"]`);
    assert.equal(impacts.length, shots, 'Each actual shot arrives exactly once');
    for (const impact of impacts) assertPoint(effectPoint(impact), combatLocalCenter(ui, findFood().querySelector('.enemy-icon')), 'All impacts use the retained icon center');
    assert.equal(ui.events.filter(event => event.type === 'activate').length, shots);
    ui.advance(300);
    assert.equal(findFood(), null, 'The corpse disappears only after all pending hits and its short fade');
  }
});

test('the last-shot visual drain remains a locked pausable battle and never starts the next course on resume', () => {
  const makeLastShot = (course = 1) => readyCombat('serviette', 1, run => {
    run.slots[1] = { id: 'paper', level: 1, uid: 'drain-paper', invested: 0 };
    run.battle.cooldowns[1] = 999;
    run.battle.spawned = run.battle.total;
    Object.assign(run.battle.enemies[0], { hp: 7, maxHp: 100, speed: 0 });
  }, { course });
  const ui = makeLastShot();
  const originalSlots = JSON.stringify(ui.read().slots);
  ui.step(16);
  assert.equal(ui.live().phase, 'prep', 'The rules have already completed the course');
  assert.equal(ui.live().course, 2);
  assert.ok(ui.core.getEncounter(ui.live()), 'The second clear queues its decision while the last shot is still being shown');
  assert.equal(ui.elements.get('game').dataset.screen, 'battle', 'Presentation waits for the lethal shot');
  const projectile = ui.document.querySelector('#combat-fx-layer .item-projectile[data-enemy-uid="test-enemy-0"]');
  const food = ui.document.querySelector('#enemy-layer .enemy');
  const first = ui.document.querySelector('#table-loadout [data-slot="0"]');
  const second = ui.document.querySelector('#table-loadout [data-slot="1"]');
  assert.ok(projectile && food && first && second);
  assert.ok(enemyHealthPercent(food) <= 7, 'The last wounded dish does not refill its health while the battle drains');
  for (const pointerType of ['touch', 'mouse']) {
    for (const node of [first, second]) {
      ui.emit('pointerdown', { target: node, pointerType });
      ui.emit('click', { target: node });
    }
    assert.equal(JSON.stringify(ui.live().slots), originalSlots, `${pointerType} cannot rearrange equipment while the last shot is visible`);
    assert.equal(ui.document.querySelector('#table-loadout [data-slot="0"]'), first, 'Inspecting or tapping does not re-render the running table');
    assert.equal(first.getAttribute('aria-pressed'), 'false');
    assert.equal(second.getAttribute('aria-pressed'), 'false');
  }
  let dragRejected = false;
  ui.emit('dragstart', { target: first, preventDefault() { dragRejected = true; }, dataTransfer: { setData() { assert.fail('A draining battle cannot begin dragging equipment'); } } });
  assert.equal(dragRejected, true);
  ui.emit('drop', { target: second, dataTransfer: { getData: () => '0' } });
  ui.emit('drop', { target: ui.elements.get('sell-zone'), dataTransfer: { getData: () => '0' } });
  assert.equal(ui.isVisible(ui.elements.get('sell-zone')), false, 'The selling area is unavailable while the last shot is still visible');
  assert.equal(JSON.stringify(ui.live().slots), originalSlots, 'The presentation drain also rejects a synthetic sale drop');
  const drainSave = ui.storage.get(saveKey);
  ui.emit('click', { target: { closest: selector => selector === '[data-upgrade]' ? { dataset: { upgrade: '0' } } : null } });
  assert.equal(ui.storage.get(saveKey), drainSave, 'Paid upgrades cannot run during the final-shot drain even though the rules already entered prep');
  const beforePause = effectPoint(projectile);
  const beforeElapsed = projectile.dataset.elapsed;
  ui.click('pause-button');
  assert.match(ui.elements.get('run-eyebrow').textContent, /GANG 2 \/ 6.*PAUSIERT/, 'The drain header retains the course being shown');
  ui.advance(1000);
  assert.equal(projectile.dataset.elapsed, beforeElapsed);
  assertPoint(effectPoint(projectile), beforePause, 'Pausing the drain freezes the last flight');
  assert.ok(food.isConnected, 'The lethal target cannot fade while the last flight is paused');
  assert.ok(enemyHealthPercent(food) <= 7, 'Pausing a final lethal shot never restores the target health');
  ui.click('serve-button');
  assert.equal(ui.live().phase, 'prep', 'Resume continues presentation and does not call startBattle for the next course');
  assert.equal(ui.live().battle, null);
  assert.equal(ui.elements.get('game').dataset.screen, 'battle');
  const impact = waitForProjectileArrival(ui, projectile);
  assertPoint(effectPoint(impact), combatLocalCenter(ui, food.querySelector('.enemy-icon')), 'The final hit still reaches the retained icon');
  assert.equal(enemyHealthPercent(food), 0, 'The final confirmed impact shows an empty health bar');
  ui.advance(800);
  assert.equal(ui.elements.get('game').dataset.screen, 'event');
  chooseVisibleEncounter(ui);
  assert.equal(ui.elements.get('game').dataset.screen, 'shop');
  assert.equal(ui.live().phase, 'prep');
  assert.equal(ui.live().course, 2);
  assert.equal(ui.live().stats.coursesCleared, 2);
  assert.equal(JSON.stringify(ui.live().slots), originalSlots);
  assert.match(ui.elements.get('run-eyebrow').textContent, /GANG 3 \/ 6/);

  const abandoned = makeLastShot(0);
  abandoned.step(16);
  assert.equal(abandoned.elements.get('game').dataset.screen, 'battle');
  abandoned.click('home-button');
  abandoned.click('continue-button');
  assert.equal(abandoned.elements.get('game').dataset.screen, 'shop', 'Returning home clears the first-round drain and continuing opens its shop directly');
  assert.equal(abandoned.core.getEncounter(abandoned.read()), null);
  assert.equal(abandoned.read().course, 1);
  assert.equal(abandoned.read().phase, 'prep');
  assert.equal(abandoned.document.querySelector('#combat-fx-layer .item-projectile'), null);
});

test('reduced motion presents the actual hit immediately at the icon without a traveling projectile', () => {
  const ui = readyCombat('serviette', 1, run => { Object.assign(run.battle.enemies[0], { hp: 1000, maxHp: 1000, speed: .12 }); }, { reducedMotion: true });
  ui.step(16);
  const activation = ui.events.find(event => event.type === 'activate');
  const damage = ui.events.find(event => event.type === 'attack');
  const impact = ui.document.querySelector('#combat-fx-layer .target-impact');
  assert.ok(activation && damage && impact);
  assert.equal(ui.document.querySelector('#combat-fx-layer .item-projectile'), null, 'Motion reduction skips travel instead of leaving a frozen projectile');
  assert.equal(impact.dataset.enemyUid, activation.targets[0].uid);
  assert.equal(impact.dataset.enemyUid, 'test-enemy-0');
  assertPoint(effectPoint(impact), combatLocalCenter(ui, ui.document.querySelector('#enemy-layer .enemy-icon')), 'Immediate feedback still uses the actual rendered target');
  assert.ok(ui.document.querySelectorAll('#battle-stage .floating-effect').some(node => node.textContent.includes(`−${damage.amount}`)));
  assert.equal(ui.events.filter(event => event.type === 'activate').length, 1, 'Motion preferences do not change the number of attacks');
});

test('the selling area explains exact fused, reserve and free-item refunds for touch and keyboard selection', () => {
  const ui = mount(savedFixture(run => {
    run.slots[1] = { id: 'headset', level: 2, uid: 'fused-headset', invested: 12 };
    run.bench = [{ id: 'awp', level: 1, uid: 'reserve-awp', invested: 9 }];
  }));
  ui.click('continue-button');
  const initialCoins = ui.read().coins;
  const zone = ui.elements.get('sell-zone');
  const button = ui.elements.get('sell-button');
  const fused = ui.document.querySelector('#slots [data-slot="1"]');
  ui.emit('pointerdown', { target: fused, pointerType: 'touch' });
  ui.select('slot', 1, '#slots');
  assert.match(zone.textContent, /Gaming-Headset/);
  assert.match(zone.textContent, /(?:Stufe|LV\.?)[^\d]*2/i);
  assert.match(button.textContent, /6\s*Pfand/);
  assert.equal(button.disabled, false);
  ui.click('sell-button');
  assert.equal(ui.read().coins, initialCoins + 6, 'The fused item refunds half its total investment');
  assert.equal(ui.read().slots[1], null);

  ui.emit('keydown', { key: 'Tab' });
  const reserve = ui.document.querySelector('#bench [data-slot="6"]');
  assert.equal(reserve.tagName, 'BUTTON');
  reserve.focus();
  ui.emit('click', { target: reserve, detail: 0 }); // Native keyboard-generated button activation.
  assert.equal(button.dataset.sell, '6');
  assert.match(zone.textContent, /AWP/);
  assert.match(button.textContent, /4\s*Pfand/);
  assert.equal(button.tagName, 'BUTTON', 'The action uses native keyboard activation semantics');
  button.focus();
  assert.equal(ui.document.activeElement, button);
  assert.equal(ui.isVisible(button), true);
  ui.click('sell-button', { detail: 0 });
  assert.equal(ui.read().coins, initialCoins + 10, 'Odd investment is rounded down exactly once');
  assert.equal(ui.read().bench.length, 0);

  ui.select('slot', 0, '#slots');
  assert.match(button.textContent, /0\s*Pfand/);
  assert.match(ui.elements.get('sell-hint').textContent, /Startausrüstung|kostenlos/i);
  assert.equal(button.disabled, false, 'The visible zero-refund explanation still permits discarding a free starter');
  ui.click('sell-button');
  assert.equal(ui.read().coins, initialCoins + 10);
  assert.equal(ui.read().slots[0], null);
  assert.equal(button.disabled, true);
});

function dragTransfer() {
  const values = new Map();
  return {
    effectAllowed: 'uninitialized', dropEffect: 'none',
    setData: (type, value) => values.set(type, String(value)),
    getData: type => values.get(type) || '',
    get types() { return [...values.keys()]; },
  };
}

test('dragging an owned item into the visible sale area previews its refund and sells once while external payloads do nothing', () => {
  const ui = mount(savedFixture(run => { run.slots[1] = { id: 'ventilator', level: 1, uid: 'drag-ventilator', invested: 6 }; }));
  ui.click('continue-button');
  const initialCoins = ui.read().coins;
  const zone = ui.elements.get('sell-zone');
  const transfer = dragTransfer();
  ui.emit('dragstart', { target: ui.document.querySelector('#slots [data-slot="1"]'), dataTransfer: transfer });
  assert.equal(zone.classList.contains('is-dragging'), true);
  assert.match(zone.textContent, /Heizlüfter/);
  assert.match(zone.textContent, /3\s*Pfand/);
  ui.emit('dragover', { target: zone, dataTransfer: transfer });
  assert.equal(zone.classList.contains('drag-over'), true);
  ui.emit('drop', { target: zone, dataTransfer: transfer });
  assert.equal(ui.read().slots[1], null);
  assert.equal(ui.read().coins, initialCoins + 3);
  assert.equal(ui.elements.get('coins-value').textContent, String(initialCoins + 3));
  assert.equal(zone.classList.contains('is-dragging'), false);
  assert.equal(zone.classList.contains('drag-over'), false);
  assert.equal(ui.elements.get('sell-button').disabled, true);
  const completedSale = ui.storage.get(saveKey);
  ui.emit('drop', { target: zone, dataTransfer: transfer });
  assert.equal(ui.storage.get(saveKey), completedSale, 'A repeated browser drop cannot sell another item');

  const external = dragTransfer();
  external.setData('text/plain', '0');
  ui.emit('dragover', { target: zone, dataTransfer: external });
  ui.emit('drop', { target: zone, dataTransfer: external });
  assert.equal(ui.storage.get(saveKey), completedSale, 'Text resembling an inventory index is not an authorized internal drag');
  assert.equal(ui.read().slots[0].id, 'serviette');
  assert.equal(ui.read().coins, initialCoins + 3);
});

test('canceling a reserve-item drag restores the selling hint and invalidates the stale drop payload', () => {
  const ui = mount(savedFixture(run => { run.bench = [{ id: 'awp', level: 1, uid: 'cancel-reserve', invested: 9 }]; }));
  ui.click('continue-button');
  const zone = ui.elements.get('sell-zone');
  const hint = ui.elements.get('sell-hint');
  const initialHint = hint.textContent;
  const before = ui.storage.get(saveKey);
  const transfer = dragTransfer();
  const source = ui.document.querySelector('#bench [data-slot="6"]');
  ui.emit('dragstart', { target: source, dataTransfer: transfer });
  assert.equal(zone.classList.contains('is-dragging'), true);
  assert.match(zone.textContent, /AWP/);
  assert.match(zone.textContent, /4\s*Pfand/);
  ui.emit('dragover', { target: zone, dataTransfer: transfer });
  ui.emit('dragend', { target: source, dataTransfer: transfer });
  assert.equal(zone.classList.contains('is-dragging'), false);
  assert.equal(zone.classList.contains('drag-over'), false);
  assert.equal(hint.textContent, initialHint);
  assert.equal(ui.elements.get('sell-button').disabled, true);
  assert.equal(ui.storage.get(saveKey), before, 'Canceled drags never mutate the actual inventory');
  ui.emit('drop', { target: zone, dataTransfer: transfer });
  assert.equal(ui.storage.get(saveKey), before, 'Drag cancellation invalidates its previous index payload');
  assert.equal(ui.read().bench[0].uid, 'cancel-reserve');
});

test('Podcast, Umut, Walkie and Snus previews show the real fusion and their visible sale refunds', () => {
  for (const id of ['podcast', 'umut', 'walkie', 'snus']) {
    const ui = mount(savedFixture((run, core) => {
      run.slots[1] = { id, level: 1, uid: `first-${id}`, invested: core.ITEMS[id].price };
      setShop(run, core, [id, 'serviette', 'paper', 'kaffee'], 18);
    }));
    ui.click('continue-button');
    const preview = ui.core.purchasePreview(ui.read(), 0);
    const card = ui.document.querySelector('[data-offer="0"]');
    ui.emit('pointerover', { target: card, relatedTarget: null });
    const tooltip = ui.elements.get('item-tooltip');
    assert.ok(tooltip.textContent.includes(preview.definition.name));
    assert.match(tooltip.textContent, /STUFE 2/);
    assert.doesNotMatch(tooltip.textContent, /undefined|NaN/);
    assert.equal(tooltip.querySelector('img.item-art')?.getAttribute('src'), preview.definition.iconPath);
    if (id === 'snus') {
      assert.match(tooltip.textContent, /Päckchen Snus/);
      assert.equal(tooltip.querySelector('img.item-art')?.getAttribute('src'), 'assets/items/snus.svg');
    }
    if (id === 'podcast') assert.match(tooltip.textContent, /3|dritt/);
    if (id === 'umut') assert.match(tooltip.textContent, /Heil/);
    if (id === 'walkie') assert.match(tooltip.textContent, /Funkpartner.*Platz 5/);
    ui.select('buy', 0);
    const fused = ui.read().slots[1];
    assert.equal(fused.uid, `first-${id}`);
    assert.equal(fused.level, 2);
    assert.equal(fused.invested, ui.core.ITEMS[id].price * 2);
    assertTableMatchesInventory(ui);
    ui.select('slot', 1, '#slots');
    assert.ok(ui.elements.get('item-detail').textContent.includes(preview.definition.name));
    assert.equal(ui.core.getSellValue(ui.read(), 1), ui.core.ITEMS[id].price);
    assert.ok(ui.elements.get('sell-button').textContent.includes(`${ui.core.ITEMS[id].price} Pfand`));
    ui.click('sell-button');
    assert.equal(ui.read().slots[1], null);
    assert.equal(ui.read().coins, 18, 'Selling refunds the actual combined investment without special currency rules');
  }
});

test('three real Podcast thoughts persist their counter and the third visibly reaches every dish', () => {
  const first = readyCombat('podcast', 3, run => {
    for (const enemy of run.battle.enemies) Object.assign(enemy, { hp: 1000, maxHp: 1000, speed: 0 });
  });
  first.step(16); first.advance(320);
  const initial = first.events.find(event => event.type === 'activate' && event.itemId === 'podcast');
  assert.ok(initial);
  assert.equal(initial.episode, 1);
  assert.equal(Boolean(initial.finale), false);
  assert.equal(initial.targets.length, 2);
  assert.equal(first.document.querySelector('#table-loadout [data-slot="0"] .runtime-badge').textContent, '1/3');
  first.click('pause-button');
  const ui = mount(first.storage); ui.click('continue-button');
  assert.equal(ui.document.querySelector('#table-loadout [data-slot="0"] .runtime-badge').textContent, '1/3', 'The saved thought counter is restored visibly');
  ui.click('serve-button'); ui.step(16);
  for (const expected of [2, 3]) {
    ui.live().battle.cooldowns[0] = 0;
    ui.step(16); ui.advance(320);
    const activation = ui.events.filter(event => event.type === 'activate' && event.itemId === 'podcast').at(-1);
    assert.equal(activation.episode, expected);
    assert.equal(Boolean(activation.finale), expected === 3);
    assert.equal(activation.targets.length, expected === 3 ? 3 : 2);
    assert.equal(ui.document.querySelector('#table-loadout [data-slot="0"] .runtime-badge').textContent, expected === 3 ? '0/3' : '2/3');
  }
  const chain = ui.events.find(event => event.type === 'chain' && event.id === 'podcast_finale');
  assert.ok(chain);
  assert.equal(ui.document.querySelector('#combat-fx-layer .chain-link[data-chain="podcast_finale"]'), null, 'The finale is its own pulse rather than a fake connection to another item');
  assert.ok(ui.elements.get('chain-feed').textContent.includes(chain.name));
  const impacted = new Set(ui.document.querySelectorAll('#combat-fx-layer .target-impact').map(node => node.dataset.enemyUid));
  assert.deepEqual([...impacted].sort(), ['test-enemy-0', 'test-enemy-1', 'test-enemy-2']);
  assert.ok(ui.live().battle.enemies.every(enemy => enemy.slowUntil > ui.live().battle.time), 'The actual finale slows every remaining target');
  assert.equal(first.events.filter(event => event.type === 'activate' && event.itemId === 'podcast').length + ui.events.filter(event => event.type === 'activate' && event.itemId === 'podcast').length, 3);
});

test('Umut visibly coats the stripped dish, prevents actual support healing, expires after resume and reports the real prevention', () => {
  const first = readyCombat('umut', 2, (run, core) => {
    Object.assign(run.battle.enemies[0], core.ENEMIES.lasagne, { type: 'lasagne', hp: 60, maxHp: 100, shield: 20, maxShield: 20, speed: 0 });
    Object.assign(run.battle.enemies[1], core.ENEMIES.suppe, { type: 'suppe', support: true, nextHeal: 0, hp: 100, maxHp: 100, shield: 0, speed: 0 });
  });
  first.step(16); first.advance(320);
  const activation = first.events.find(event => event.type === 'activate' && event.itemId === 'umut');
  assert.ok(activation);
  assert.equal(activation.targets[0].uid, 'test-enemy-0', 'The actual armored dish is chosen');
  const blocked = first.events.filter(event => event.type === 'enemy_heal_blocked' && event.enemyUid === 'test-enemy-0');
  assert.ok(blocked.length > 0);
  const prevented = blocked.reduce((sum, event) => sum + event.amount, 0);
  assert.equal(prevented, 6);
  const food = first.document.querySelector('#enemy-layer .enemy[data-enemy-uid="test-enemy-0"]');
  assert.ok(food.classList.contains('painted'));
  assert.match(food.title, /Heil/);
  assert.ok(first.document.querySelector('#combat-fx-layer .paint-splash[data-enemy-uid="test-enemy-0"]'), 'The paint splash belongs to the actual affected food');
  assert.ok(first.document.querySelector('#combat-fx-layer .target-impact[data-effect="paint"][data-enemy-uid="test-enemy-0"]'), 'The paint attack reaches its actual target before the impact is shown');
  assert.ok(first.document.querySelectorAll('#battle-stage .floating-effect').some(node => /Nachschlag blockiert/.test(node.textContent)));
  first.click('pause-button');
  const ui = mount(first.storage); ui.click('continue-button');
  assert.ok(ui.document.querySelector('#enemy-layer .enemy[data-enemy-uid="test-enemy-0"]').classList.contains('painted'));
  ui.click('serve-button'); ui.advance(3500);
  assert.equal(ui.document.querySelector('#enemy-layer .enemy[data-enemy-uid="test-enemy-0"]').classList.contains('painted'), false, 'The visual coating expires with its saved rule timer');
  assert.ok(ui.events.some(event => event.type === 'enemy_heal' && event.enemyUid === 'test-enemy-0'), 'Support healing works again after the coating expires');
  const reportItem = ui.live().battle.report.items.find(item => item.id === 'umut');
  assert.equal(reportItem.healingPrevented, prevented, 'The resumed report preserves only the actual blocked healing');
  ui.live().battle.spawned = ui.live().battle.total;
  for (const enemy of ui.live().battle.enemies) { enemy.x = .001; enemy.speed = 1; }
  ui.advance(800);
  const report = ui.core.getBattleReport(ui.read());
  assert.equal(report.items.find(item => item.id === 'umut').healingPrevented, prevented);
  const insight = report.insights.find(text => /Heil/.test(text) && text.includes(String(prevented)));
  assert.ok(insight, 'The finished report explains the measured healing prevention');
  assert.equal(ui.elements.get('game').dataset.screen, 'shop', 'The first clear leaves the report accessible directly from the shop');
  ui.click('report-toggle');
  assert.ok(ui.elements.get('report-body').textContent.includes(insight));
});

test('Walkie-Talkies visibly recharge only the fixed opposite partner and never fabricate its activation', () => {
  for (const occupied of [true, false]) {
    const ui = readyCombat('walkie', 0, run => {
      run.slots[1] = { id: 'headset', level: 1, uid: 'near-headset', invested: 6 };
      run.battle.cooldowns[1] = 8;
      if (occupied) {
        run.slots[5] = { id: 'awp', level: 1, uid: 'opposite-awp', invested: 9 };
        run.battle.cooldowns[5] = 4;
      }
    });
    ui.step(16);
    const activation = ui.events.find(event => event.type === 'activate' && event.itemId === 'walkie');
    assert.ok(activation);
    assert.deepEqual(Array.from(activation.rechargedSlots || []), occupied ? [5] : []);
    assert.equal(ui.events.filter(event => event.type === 'activate').length, 1, 'The radio changes cooldown and does not invent a partner attack');
    assert.ok(Math.abs(ui.live().battle.cooldowns[1] - (8 - .016)) < 1e-6, 'An adjacent item receives no radio recharge');
    assert.equal(ui.live().willpower, 100);
    assert.equal(ui.live().coins, ui.core.ECONOMY.startingCoins);
    assert.equal(ui.live().battle.shield, ui.core.getItemStats(ui.live(), 0).power);
    const link = ui.document.querySelector('#combat-fx-layer .radio-link');
    if (occupied) {
      assert.ok(link);
      assert.ok(link.classList.contains('support-link'));
      assert.equal(link.dataset.kind, 'radio');
      assert.equal(ui.document.querySelectorAll('#combat-fx-layer .support-impact[data-kind="radio"]').length, 1);
      assert.equal(link.dataset.sourceSlot, '0');
      assert.equal(link.dataset.targetSlot, '5');
      assert.equal(link.dataset.effectRole, 'link');
      const source = combatLocalCenter(ui, ui.document.querySelector('#table-loadout [data-slot="0"]'));
      const target = combatLocalCenter(ui, ui.document.querySelector('#table-loadout [data-slot="5"]'));
      assertPoint(effectPoint(link), source, 'The radio link starts at the real radio item');
      const angle = parseFloat(link.style.getPropertyValue('--flight-angle')) * Math.PI / 180;
      const length = parseFloat(link.style.width);
      assertPoint({ x: source.x + Math.cos(angle) * length, y: source.y + Math.sin(angle) * length }, target, 'The radio link reaches the actual opposite item');
      assert.ok(ui.document.querySelector('#table-loadout [data-slot="5"]').classList.contains('is-boosted'));
      assert.ok(Math.abs(ui.live().battle.cooldowns[5] - (4 - 1.2 - .016)) < 1e-6);
    } else assert.equal(link, null, 'No beam or recharge is invented for an empty opposite place');
    assert.equal(ui.document.querySelectorAll('#combat-fx-layer [data-effect-role="target"]').length, 0, 'A table-to-table link is not a fake enemy impact');
  }
});

test('paid item controls reach level three with honest cost and stat previews and then reject further spending', () => {
  const ui = mount(); ui.click('new-run-button');
  const starting = ui.read();
  const originalUid = starting.slots[0].uid;
  const originalRng = starting.randomState;
  ui.select('slot', 0, '#slots');
  const display = number => Number(number.toFixed(1)).toLocaleString('de-DE');
  let paid = 0;
  for (const level of [2, 3]) {
    const before = ui.storage.get(saveKey);
    const preview = ui.core.upgradePreview(ui.read(), 0);
    const button = ui.elements.get('upgrade-button');
    assert.ok(preview?.affordable);
    assert.equal(button.tagName, 'BUTTON');
    assert.equal(ui.isVisible(button), true);
    assert.equal(button.disabled, false);
    assert.equal(button.dataset.upgrade, '0');
    assert.equal(button.getAttribute('aria-describedby'), 'upgrade-hint');
    assert.ok(button.textContent.includes(`Stufe ${level}`));
    assert.ok(button.textContent.includes(`${preview.cost} Pfand`));
    const hint = ui.elements.get('upgrade-hint').textContent;
    assert.ok(hint.includes(display(preview.stats.power)));
    assert.ok(hint.includes(`${display(preview.stats.cooldown)} s`));
    assert.equal(ui.storage.get(saveKey), before, 'Rendering the paid upgrade preview does not change the save or RNG');
    ui.click('upgrade-button', { detail: 0 });
    paid += preview.cost;
    assert.equal(ui.read().slots[0].uid, originalUid);
    assert.equal(ui.read().slots[0].level, level);
    assert.equal(ui.read().slots[0].invested, paid, 'A formerly free starter records its paid upgrades for refunds');
    assert.equal(ui.read().coins, starting.coins - paid);
    assert.equal(ui.read().stats.coinsSpent, starting.stats.coinsSpent + paid);
    assert.equal(ui.read().randomState, originalRng);
    assert.equal(ui.document.activeElement.id, 'item-detail-name');
    assert.equal(ui.isVisible(ui.document.activeElement), true);
    assertTableMatchesInventory(ui);
  }
  const maximum = ui.elements.get('upgrade-button');
  assert.equal(maximum.disabled, true);
  assert.match(maximum.textContent, /Maximale Stufe 3/);
  assert.equal(maximum.dataset.upgrade, undefined);
  assert.equal(ui.core.getSellValue(ui.read(), 0), Math.floor(paid / 2));
  const maxedSave = ui.storage.get(saveKey);
  ui.emit('click', { target: maximum });
  assert.equal(ui.storage.get(saveKey), maxedSave, 'An already maximal item cannot consume coins on a synthetic disabled click');
  const restored = mount(ui.storage); restored.click('continue-button');
  assert.equal(restored.read().slots[0].level, 3);
  assert.equal(restored.read().slots[0].invested, paid);
  assert.equal(restored.read().coins, starting.coins - paid);
});

test('unaffordable paid upgrades show the missing amount and reject delegated disabled actions', () => {
  const ui = mount(savedFixture(run => {
    run.coins = 17;
    run.slots[1] = { id: 'awp', level: 2, uid: 'poor-awp', invested: 18, tactic: 'marked' };
  }));
  ui.click('continue-button'); ui.select('slot', 1, '#slots');
  const cost = ui.core.getUpgradeCost(ui.read(), 1);
  const button = ui.elements.get('upgrade-button');
  assert.equal(cost, ui.core.ITEMS.awp.price * 2);
  assert.equal(button.disabled, true);
  assert.ok(button.textContent.includes(`${cost} Pfand`));
  assert.ok(ui.elements.get('upgrade-hint').textContent.includes(`${cost - ui.read().coins} Pfand fehlen`));
  const before = ui.storage.get(saveKey);
  ui.select('upgrade', 1); // The actual delegated handler must reject it as well.
  assert.equal(ui.storage.get(saveKey), before);
  assert.equal(ui.read().slots[1].level, 2);
  assert.equal(ui.read().slots[1].tactic, 'marked');
});

test('upgrading a reserve item honestly previews a fusion cascade and follows the surviving UID, tactic and investment', () => {
  const ui = mount(savedFixture((run, core) => {
    run.coins = core.ITEMS.awp.price;
    run.slots[0] = { id: 'awp', level: 2, uid: 'anchored-awp', invested: core.ITEMS.awp.price * 2, tactic: 'marked' };
    run.bench = [{ id: 'awp', level: 1, uid: 'selected-awp', invested: core.ITEMS.awp.price, tactic: 'threat' }];
  }));
  ui.click('continue-button'); ui.select('slot', 6, '#bench');
  const before = ui.storage.get(saveKey);
  const preview = ui.core.upgradePreview(ui.read(), 6);
  assert.equal(preview.item.uid, 'anchored-awp');
  assert.equal(preview.item.level, 3);
  assert.equal(preview.index, 0);
  const button = ui.elements.get('upgrade-button');
  assert.equal(button.dataset.upgrade, '6');
  assert.ok(button.textContent.includes('Stufe 3'), 'The UI previews the final cascade result rather than promising only level two');
  assert.ok(button.textContent.includes(`${preview.cost} Pfand`));
  assert.match(ui.elements.get('upgrade-hint').textContent, /inklusive Fusion/);
  assert.equal(ui.storage.get(saveKey), before);
  ui.click('upgrade-button');
  const after = ui.read();
  assert.equal(after.coins, 0);
  assert.equal(after.stats.coinsSpent, preview.cost);
  assert.equal(after.bench.length, 0);
  assert.equal(after.slots[0].uid, 'anchored-awp');
  assert.equal(after.slots[0].level, 3);
  assert.equal(after.slots[0].tactic, 'marked');
  assert.equal(after.slots[0].invested, ui.core.ITEMS.awp.price * 4);
  assert.equal(ui.document.querySelector('#slots [data-slot="0"]').getAttribute('aria-pressed'), 'true', 'Selection follows the actual surviving equipped item');
  assert.equal(ui.document.activeElement.id, 'item-detail-name');
  assert.match(ui.elements.get('item-detail-name').textContent, /AWP.*Stufe 3/);
  assert.equal(ui.elements.get('upgrade-button').disabled, true);
  assertTableMatchesInventory(ui);
  const restored = mount(ui.storage); restored.click('continue-button'); restored.select('slot', 0, '#slots');
  assert.equal(restored.read().slots[0].uid, 'anchored-awp');
  assert.equal(restored.read().slots[0].tactic, 'marked');
  const refund = ui.core.ITEMS.awp.price * 2;
  assert.ok(restored.elements.get('sell-button').textContent.includes(`${refund} Pfand`));
  restored.click('sell-button');
  assert.equal(restored.read().coins, refund, 'The saved cascade refunds half all purchases and paid upgrades');
  assert.equal(restored.read().slots[0], null);
});

test('Ritalin previews and upgrades its actual recharge rather than zero strength, then persists its paid refund', () => {
  const ui = mount(savedFixture((run, core) => { setShop(run, core, ['ritalin', 'serviette', 'paper', 'kaffee'], 36); }));
  ui.click('continue-button');
  const card = ui.document.querySelector('[data-offer="0"]');
  const before = ui.storage.get(saveKey);
  ui.emit('pointerover', { target: card, relatedTarget: null });
  const tooltip = ui.elements.get('item-tooltip');
  assert.match(tooltip.textContent, /Ritalin/);
  assert.match(tooltip.textContent, /1,2\s*s/);
  assert.match(tooltip.textContent, /waagerecht.*senkrecht/);
  assert.doesNotMatch(tooltip.textContent, /0\s*(?:Stärke|Schaden|Schild)|undefined|NaN/);
  assert.match(card.querySelector('.offer-stats').textContent, /1,2\s*s Aufladehilfe/);
  assert.doesNotMatch(card.querySelector('.offer-stats').textContent, /0\s*Stärke/);
  assert.equal(tooltip.querySelector('img.item-art')?.getAttribute('src'), 'assets/items/ritalin.svg');
  assert.equal(ui.storage.get(saveKey), before, 'Reading the new support item leaves money and inventory untouched');
  ui.select('buy', 0);
  const purchased = ui.read().slots.find(item => item?.id === 'ritalin');
  assert.ok(purchased);
  assert.equal(ui.read().coins, 30);
  ui.select('slot', 1, '#slots');
  assert.match(ui.elements.get('item-detail').querySelector('.stat-line').textContent, /1,2\s*s Aufladehilfe/);
  assert.match(ui.elements.get('upgrade-hint').textContent, /1,5\s*s Aufladehilfe/);
  assert.doesNotMatch(ui.elements.get('upgrade-hint').textContent, /0\s*Stärke/);
  ui.click('upgrade-button');
  assert.equal(ui.read().slots[1].uid, purchased.uid);
  assert.equal(ui.read().slots[1].level, 2);
  assert.equal(ui.read().slots[1].invested, 12);
  assert.equal(ui.read().coins, 24);
  assert.match(ui.elements.get('item-detail').querySelector('.stat-line').textContent, /1,5\s*s Aufladehilfe/);
  assert.match(ui.elements.get('upgrade-hint').textContent, /1,8\s*s Aufladehilfe/);
  const restored = mount(ui.storage); restored.click('continue-button'); restored.select('slot', 1, '#slots');
  assert.equal(restored.read().slots[1].uid, purchased.uid);
  assert.equal(restored.read().slots[1].level, 2);
  assert.match(restored.elements.get('item-detail').querySelector('.stat-line').textContent, /1,5\s*s Aufladehilfe/);
  assert.match(restored.elements.get('sell-button').textContent, /6\s*Pfand/);
  restored.click('sell-button');
  assert.equal(restored.read().slots[1], null);
  assert.equal(restored.read().coins, 30, 'Selling returns half the combined purchase and upgrade investment');
});

test('Ritalin highlights only actually recharged orthogonal items without damage, shield or off-table targets', () => {
  for (const readyNeighbor of [true, false]) {
    const ui = readyCombat('ritalin', 0, run => {
      const source = run.slots[0];
      run.slots = [
        { id: 'headset', level: 1, uid: 'haste-left', invested: 6 },
        source,
        readyNeighbor ? { id: 'serviette', level: 1, uid: 'haste-ready', invested: 0 } : null,
        { id: 'batomon', level: 1, uid: 'haste-diagonal', invested: 6 },
        { id: 'awp', level: 1, uid: 'haste-below', invested: 9 },
        null,
      ];
      run.bench = [{ id: 'beer', level: 1, uid: 'haste-bench', invested: 4 }];
      run.battle.cooldowns = [8, 0, 0, 5, 6, 0];
    });
    ui.step(16);
    const activation = ui.events.find(event => event.type === 'activate' && event.itemId === 'ritalin');
    assert.ok(activation);
    assert.equal(activation.slot, 1);
    assert.equal(activation.targets.length, 0);
    assert.deepEqual(Array.from(activation.rechargedSlots), [0, 4]);
    assert.equal(ui.events.filter(event => event.type === 'activate').length, 1, 'Recharge does not fabricate recipient activations');
    assert.equal(ui.events.some(event => ['attack', 'kill', 'shield', 'guard'].includes(event.type)), false);
    assert.equal(ui.live().stats.damageDealt, 0);
    assert.equal(ui.live().battle.shield, 0);
    assert.equal(ui.live().willpower, 100);
    assert.equal(ui.live().coins, ui.core.ECONOMY.startingCoins);
    assert.ok(Math.abs(ui.live().battle.cooldowns[0] - (8 - .016 - 1.2)) < 1e-6);
    assert.ok(Math.abs(ui.live().battle.cooldowns[4] - (6 - .016 - 1.2)) < 1e-6);
    assert.ok(Math.abs(ui.live().battle.cooldowns[3] - (5 - .016)) < 1e-6, 'The diagonal item only counts down normally');
    assert.equal(ui.document.querySelectorAll('#combat-fx-layer .haste-wave').length, 1);
    const links = ui.document.querySelectorAll('#combat-fx-layer .haste-link');
    const impacts = ui.document.querySelectorAll('#combat-fx-layer .haste-impact');
    assert.equal(links.length, 2);
    assert.equal(impacts.length, 2);
    assert.ok(links.every(node => node.classList.contains('support-link') && node.dataset.kind === 'haste'));
    assert.ok(impacts.every(node => node.classList.contains('support-impact') && node.dataset.kind === 'haste'));
    for (const link of links) assertTableLink(ui, link, 1, Number(link.dataset.targetSlot));
    assert.deepEqual(links.map(node => node.dataset.targetSlot).sort(), ['0', '4']);
    assert.deepEqual(impacts.map(node => node.dataset.targetSlot).sort(), ['0', '4']);
    for (const node of [...links, ...impacts]) assert.equal(node.dataset.sourceSlot, '1');
    assert.ok(links.every(node => node.dataset.effectRole === 'link'));
    assert.ok(impacts.every(node => node.dataset.effectRole === 'recipient'));
    assert.equal(ui.document.querySelectorAll('#combat-fx-layer .item-projectile').length, 0, 'This support item sends no projectile toward food or Gabriel');
    assert.equal(ui.document.querySelectorAll('#combat-fx-layer [data-effect-role="target"]').length, 0, 'Table recipients are not mislabeled as enemy impacts');
    for (const index of [0, 4]) assert.ok(ui.document.querySelector(`#table-loadout [data-slot="${index}"]`).classList.contains('is-boosted'));
    for (const index of [2, 3, 5]) assert.equal(ui.document.querySelector(`#table-loadout [data-slot="${index}"]`).classList.contains('is-boosted'), false);
    assert.equal(ui.live().bench[0].uid, 'haste-bench');
  }
});

function fillCapacityFixture(run, core, overflow = false) {
  run.slots = ['serviette', 'paper', 'ventilator', 'headset', 'luca', 'desolator'].map((id, index) => ({ id, level: 1, uid: `capacity-table-${index}`, invested: core.ITEMS[id].price }));
  run.bench = ['snus', 'podcast', 'umut', ...(overflow ? ['ritalin'] : [])].map((id, index) => ({ id, level: 1, uid: `capacity-bank-${index}`, invested: core.ITEMS[id].price }));
}

test('a full three-item bank blocks a non-fusing purchase atomically while keeping its hover effect available', () => {
  const ui = mount(savedFixture((run, core) => {
    fillCapacityFixture(run, core);
    setShop(run, core, ['awp', 'ritalin', 'beer', 'kaffee'], 36);
  }));
  ui.click('continue-button');
  assert.match(ui.elements.get('bench-count').textContent, /3\s*\/\s*3/);
  assert.equal(ui.document.querySelectorAll('#bench [data-slot]').length, 3);
  const offer = ui.document.querySelector('[data-offer="0"]');
  const buy = offer.querySelector('[data-buy="0"]');
  assert.equal(buy.disabled, true, 'Enough money is insufficient when neither table nor bank has space');
  assert.match(buy.textContent, /Bank voll/);
  assert.match(buy.getAttribute('title'), /verkauf|Tisch|Platz/i);
  assert.equal(ui.core.purchasePreview(ui.read(), 0), null);
  const before = ui.storage.get(saveKey);
  ui.emit('pointerover', { target: offer, relatedTarget: null });
  const tooltip = ui.elements.get('item-tooltip');
  assert.equal(tooltip.hidden, false);
  assert.match(tooltip.textContent, /AWP/);
  assert.ok(tooltip.textContent.includes(displayNumber(ui.core.ITEMS.awp.power)), 'Capacity rejection does not remove the base effect information');
  assert.doesNotMatch(tooltip.textContent, /undefined|NaN/);
  ui.select('buy', 0); // The delegated handler must reject it as well as disabling the control.
  assert.equal(ui.storage.get(saveKey), before, 'Blocked buying and inspection preserve coins, UIDs, inventory and RNG');
  assert.equal(ui.read().coins, 36);
  assert.equal(ui.read().bench.length, 3);
});

test('a full bank permits a capacity-neutral fusion purchase and selling a reserve re-enables other offers', () => {
  const ui = mount(savedFixture((run, core) => {
    fillCapacityFixture(run, core);
    setShop(run, core, ['serviette', 'awp', 'beer', 'kaffee'], 36);
  }));
  ui.click('continue-button');
  const originalUid = ui.read().slots[0].uid;
  const originalBank = ui.read().bench.map(item => item.uid);
  assert.equal(ui.document.querySelector('[data-buy="0"]').disabled, false, 'An automatic fusion requires no extra bank space');
  assert.equal(ui.document.querySelector('[data-buy="1"]').disabled, true);
  ui.emit('pointerover', { target: ui.document.querySelector('[data-offer="0"]'), relatedTarget: null });
  assert.match(ui.elements.get('item-tooltip').textContent, /STUFE 2/);
  ui.select('buy', 0);
  assert.equal(ui.read().slots[0].uid, originalUid);
  assert.equal(ui.read().slots[0].level, 2);
  assert.deepEqual(ui.read().bench.map(item => item.uid), originalBank);
  assert.match(ui.elements.get('bench-count').textContent, /3\s*\/\s*3/);
  assert.equal(ui.document.querySelector('[data-buy="1"]').disabled, true, 'The successful fusion did not create an extra reserve slot');
  const refund = ui.core.getSellValue(ui.read(), 6);
  ui.select('slot', 6, '#bench'); ui.click('sell-button');
  assert.match(ui.elements.get('bench-count').textContent, /2\s*\/\s*3/);
  assert.equal(ui.document.querySelector('[data-buy="1"]').disabled, false, 'A real sale immediately unlocks a purchase that needs bank space');
  ui.select('buy', 1);
  assert.equal(ui.read().bench.length, 3);
  assert.equal(ui.read().bench.at(-1).id, 'awp');
  assert.equal(ui.read().coins, 36 - ui.core.ITEMS.serviette.price + refund - ui.core.ITEMS.awp.price);
  assert.match(ui.elements.get('bench-count').textContent, /3\s*\/\s*3/);
});

test('an older four-item reserve survives reload but cannot start combat until its overflow is resolved', () => {
  const storage = savedFixture((run, core) => {
    fillCapacityFixture(run, core, true);
    setShop(run, core, ['awp', 'ritalin', 'beer', 'kaffee'], 36);
  });
  const original = JSON.parse(storage.get(saveKey));
  const ui = mount(storage); ui.click('continue-button');
  assert.deepEqual(ui.read().bench.map(item => item.uid), original.bench.map(item => item.uid), 'Loading never discards old reserve items');
  assert.match(ui.elements.get('bench-count').textContent, /4\s*\/\s*3/);
  assert.equal(ui.document.querySelectorAll('#bench [data-slot]').length, 4);
  assert.equal(ui.isVisible(ui.elements.get('bench-hint')), true);
  assert.equal(ui.elements.get('bench-hint').getAttribute('role'), 'status');
  assert.match(ui.elements.get('bench-hint').textContent, /reduzieren.*(?:Tisch|verkaufe)/);
  assert.equal(ui.elements.get('shop-serve-button').disabled, true);
  assert.equal(ui.elements.get('serve-button').disabled, true);
  const before = ui.storage.get(saveKey);
  ui.elements.get('shop-serve-button').emit('click'); // The Core guard also rejects a disabled synthetic activation.
  assert.equal(ui.read().phase, 'prep');
  assert.equal(ui.elements.get('game').dataset.screen, 'shop');
  assert.equal(ui.storage.get(saveKey), before);
  ui.select('slot', 9, '#bench');
  const removed = ui.read().bench[3];
  const refund = ui.core.getSellValue(ui.read(), 9);
  ui.click('sell-button');
  assert.equal(ui.read().bench.length, 3);
  assert.deepEqual(ui.read().bench.map(item => item.uid), original.bench.slice(0, 3).map(item => item.uid));
  assert.equal(ui.read().bench.some(item => item.uid === removed.uid), false);
  assert.equal(ui.read().coins, original.coins + refund);
  assert.match(ui.elements.get('bench-count').textContent, /3\s*\/\s*3/);
  assert.equal(ui.elements.get('bench-hint').hidden, true);
  assert.equal(ui.elements.get('shop-serve-button').disabled, false);
  ui.click('shop-serve-button');
  assert.equal(ui.read().phase, 'battle');
  assert.equal(ui.elements.get('game').dataset.screen, 'battle');
  assert.equal(ui.read().bench.length, 3);
});

function pendingEncounterFixture(id, configure) {
  return savedFixture((run, core) => {
    run.encounters.deck = [id, ...run.encounters.deck.filter(entry => entry !== id)];
    run.course = 1;
    run.shop.visit = 1;
    run.stats.coursesCleared = 1;
    run.willpower = 60;
    core.startBattle(run);
    run.battle.spawned = run.battle.total;
    run.battle.enemies = [];
    core.updateBattle(run, .05);
    configure?.(run, core);
  });
}

test('clearing the second course presents a mandatory event screen and the selected response applies its exact immediate effects', () => {
  const ui = mount(savedFixture((run, core) => {
    run.coins = 2;
    run.willpower = 60;
    run.encounters.deck = ['anka', ...run.encounters.deck.filter(id => id !== 'anka')];
    run.course = 1;
    run.shop.visit = 1;
    run.stats.coursesCleared = 1;
    core.startBattle(run);
    run.battle.spawned = run.battle.total;
    run.battle.enemies = [];
  }));
  ui.click('continue-button'); ui.click('serve-button'); ui.tick();
  const event = ui.core.getEncounter(ui.read());
  assert.equal(event.id, 'anka');
  assert.equal(ui.elements.get('game').dataset.screen, 'event');
  assert.equal(ui.isVisible(ui.elements.get('event-screen')), true);
  assert.equal(ui.isVisible(ui.elements.get('shop-screen')), false);
  assert.equal(ui.isVisible(ui.elements.get('battle-screen')), false);
  assert.equal(ui.isVisible(ui.elements.get('round-recap')), false, 'The encounter is not buried under the report');
  assert.equal(ui.elements.get('event-title').textContent, event.title);
  assert.equal(ui.elements.get('event-description').textContent, event.description);
  assert.equal(ui.elements.get('event-quote').textContent, event.quote);
  assert.equal(ui.elements.get('event-progress').textContent, '1 / 2');
  assert.equal(ui.document.activeElement.id, 'event-title');
  assert.equal(ui.document.querySelectorAll('#event-choices [data-event-choice]').length, event.choices.length);
  const before = ui.storage.get(saveKey);
  ui.elements.get('shop-serve-button').emit('click');
  assert.equal(ui.storage.get(saveKey), before, 'A pending decision cannot be skipped by activating the hidden start control');
  const oldCoins = ui.read().coins;
  const oldWillpower = ui.read().willpower;
  chooseVisibleEncounter(ui, 'call');
  assert.equal(ui.read().coins, oldCoins + 4);
  assert.equal(ui.read().willpower, oldWillpower - 8);
  assert.equal(ui.read().encounters.history.length, 1);
  assert.equal(ui.read().encounters.history[0].id, 'anka');
  assert.equal(ui.read().encounters.history[0].choiceId, 'call');
  assert.equal(ui.read().encounters.history[0].coinsDelta, 4);
  assert.equal(ui.read().encounters.history[0].willpowerDelta, -8);
  assert.equal(ui.core.getEventBuff(ui.read()), null);
  assert.equal(ui.elements.get('game').dataset.screen, 'shop');
  assert.equal(ui.isVisible(ui.elements.get('event-screen')), false);
  assert.equal(ui.elements.get('coins-value').textContent, String(oldCoins + 4));
  assert.equal(ui.elements.get('prep-willpower').textContent, String(oldWillpower - 8));
  assert.ok(ui.elements.get('shop-summary').textContent.includes(ui.read().encounters.history[0].message));
  assert.equal(ui.document.activeElement.id, 'screen-title');
  assert.equal(ui.isVisible(ui.document.activeElement), true);
});

test('pending encounters reload identically, reject repeat clicks and show their buff for exactly the next battle', () => {
  const first = mount(pendingEncounterFixture('bluetooth')); first.click('continue-button');
  const pending = first.read().encounters.pending;
  const title = first.elements.get('event-title').textContent;
  const choices = first.elements.get('event-choices').textContent;
  const ui = mount(first.storage); ui.click('continue-button');
  assert.deepEqual(ui.read().encounters.pending, pending);
  assert.equal(ui.elements.get('event-title').textContent, title);
  assert.equal(ui.elements.get('event-choices').textContent, choices);
  assert.equal(ui.document.activeElement.id, 'event-title');
  assert.equal(ui.read().encounters.history.length, 0);
  const staleButton = ui.document.querySelector('[data-event-choice="reclaim"]');
  const beforeCoins = ui.read().coins;
  chooseVisibleEncounter(ui, 'reclaim');
  assert.equal(ui.read().coins, beforeCoins - 3);
  assert.equal(ui.read().willpower, 60);
  const buff = ui.core.getEventBuff(ui.read());
  assert.ok(buff);
  const shopBuffs = ui.elements.get('shop-event-buffs');
  assert.equal(ui.isVisible(shopBuffs), true);
  assert.ok(shopBuffs.textContent.includes(buff.label));
  assert.ok(shopBuffs.textContent.includes(buff.description));
  assert.match(shopBuffs.textContent, /Nächster Gang/);
  const chosen = ui.storage.get(saveKey);
  ui.emit('click', { target: staleButton });
  assert.equal(ui.storage.get(saveKey), chosen, 'A repeated event response cannot spend again or duplicate history');
  assert.equal(ui.read().encounters.history.length, 1);
  for (const legacyCourse of [1, 3, 5]) {
    const legacy = ui.read();
    legacy.course = legacyCourse;
    legacy.shop.visit = legacyCourse;
    legacy.encounters.pending = { id: 'anka', course: legacyCourse };
    if (legacyCourse === 1) legacy.encounters.history = [];
    const history = JSON.parse(JSON.stringify(legacy.encounters.history));
    const migrated = mount(new Map([[saveKey, JSON.stringify(legacy)]]));
    migrated.click('continue-button');
    assert.equal(migrated.elements.get('game').dataset.screen, 'shop', `An obsolete round-${legacyCourse} event no longer interrupts the shop`);
    assert.equal(migrated.core.getEncounter(migrated.read()), null);
    migrated.select('lock', 0); // A normal shop action persists the migrated state.
    assert.equal(migrated.read().encounters.pending, null);
    assert.deepEqual(migrated.read().encounters.history, history, 'Dropping an obsolete pending event preserves resolved choices');
    assert.deepEqual(JSON.parse(JSON.stringify(migrated.core.getEventBuff(migrated.read()))), JSON.parse(JSON.stringify(buff)), 'Migration preserves the already selected one-battle bonus');
    assert.ok(migrated.elements.get('shop-event-buffs').textContent.includes(buff.label));
  }
  ui.click('shop-serve-button'); ui.step(16);
  assert.equal(ui.read().phase, 'battle');
  assert.equal(ui.read().encounters.nextBuff, null);
  const battleBuffs = ui.elements.get('battle-event-buffs');
  assert.equal(ui.isVisible(battleBuffs), true);
  assert.ok(battleBuffs.textContent.includes(buff.label));
  assert.match(battleBuffs.textContent, /Dieser Gang/);
  assert.ok(ui.events.some(event => event.type === 'event_buff'), 'The displayed battle buff corresponds to an actual combat event');
  ui.click('pause-button');
  const restored = mount(ui.storage); restored.click('continue-button');
  assert.equal(ui.isVisible(restored.elements.get('battle-event-buffs')), true);
  assert.ok(restored.elements.get('battle-event-buffs').textContent.includes(buff.label));
  assert.deepEqual(JSON.parse(JSON.stringify(restored.core.getEventBuff(restored.read()))), JSON.parse(JSON.stringify(buff)));
  restored.click('serve-button'); restored.step(16);
  restored.live().battle.spawned = restored.live().battle.total;
  restored.live().battle.enemies = [];
  restored.live().battle.cooldowns.fill(999);
  restored.advance(800);
  assert.equal(restored.read().course, 3);
  assert.equal(restored.elements.get('game').dataset.screen, 'shop', 'The buffed third round returns directly to the shop');
  assert.equal(restored.core.getEncounter(restored.read()), null);
  assert.equal(restored.core.getEventBuff(restored.read()), null, 'A consumed event buff ends with its one battle');
  assert.equal(restored.elements.get('shop-event-buffs').hidden, true);
  assert.equal(restored.elements.get('battle-event-buffs').hidden, true);
  assert.equal(restored.read().encounters.history.length, 1);
  restored.click('shop-serve-button');
  restored.live().battle.spawned = restored.live().battle.total;
  restored.live().battle.enemies = [];
  restored.live().battle.cooldowns.fill(999);
  restored.advance(800);
  assert.equal(restored.read().course, 4);
  assert.equal(restored.elements.get('game').dataset.screen, 'event');
  assert.equal(restored.elements.get('event-progress').textContent, '2 / 2');
  assert.notEqual(restored.core.getEncounter(restored.read()).id, 'bluetooth', 'The second event cannot repeat the first used ID');
});

test('unaffordable encounter choices display their reasons and reject disabled synthetic selections', () => {
  const ui = mount(pendingEncounterFixture('update', run => { run.coins = 0; run.willpower = 5; }));
  ui.click('continue-button');
  const event = ui.core.getEncounter(ui.read());
  assert.equal(event.id, 'update');
  const before = ui.storage.get(saveKey);
  for (const id of ['skip', 'patch']) {
    const choice = event.choices.find(option => option.id === id);
    const button = ui.document.querySelector(`[data-event-choice="${id}"]`);
    assert.equal(choice.affordable, false);
    assert.equal(button.disabled, true);
    assert.equal(ui.isVisible(button), true);
    assert.ok(choice.disabledReason.length > 0);
    assert.ok(button.textContent.includes(choice.disabledReason), 'The resource requirement is readable without hover');
    assert.ok(button.getAttribute('aria-label').includes(choice.disabledReason));
    ui.select('event-choice', id, '#event-choices');
    assert.equal(ui.storage.get(saveKey), before, 'Rejected choices leave the pending event, history, coins and willpower unchanged');
  }
  assert.equal(ui.elements.get('event-hint').getAttribute('role'), 'status');
  assert.equal(ui.document.querySelector('[data-event-choice="offline"]').disabled, false);
  chooseVisibleEncounter(ui, 'offline');
  assert.equal(ui.read().coins, 0);
  assert.equal(ui.read().willpower, 5);
  assert.equal(ui.elements.get('game').dataset.screen, 'shop');
  assert.equal(ui.core.getEventBuff(ui.read()).startingShield, 8);
});
