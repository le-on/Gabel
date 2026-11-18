(() => {
  'use strict';
  const Core = globalThis.AbendessenCore;
  const { ITEMS, ENEMIES, COURSES, MAX_BENCH_SIZE } = Core;
  const $ = id => document.getElementById(id);
  const SAVE_KEY = 'gabriel-abendessen-run-v1';
  const RECORD_KEY = 'gabriel-abendessen-record-v1';
  const SOUND_KEY = 'gabriel-abendessen-sound-v1';
  const VOLUME_KEY = 'gabriel-abendessen-volume-v1';
  const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const format = value => Number(value.toFixed(1)).toLocaleString('de-DE');
  const rarityNames = { common: 'Alltagstauglich', uncommon: 'Besonders praktisch', rare: 'Selten & begehrt' };
  let run = null;
  let selected = null;
  let draggedItem = null;
  let paused = false;
  let speed = 1;
  let gameVisible = false;
  let soundEnabled = false;
  let soundVolume = .45;
  let audioUnavailable = false;
  let audioGeneration = 0;
  let lastEncounterSound = null;
  let pendingResultSound = null;
  const sound = typeof globalThis.AbendessenAudio === 'function' ? globalThis.AbendessenAudio({ AudioContext: window.AudioContext || window.webkitAudioContext }) : null;
  let lastFrame = 0;
  let lastHUD = 0;
  let lastSaved = 0;
  let toastTimer;
  let saveAvailable = true;
  let record = { wins: 0, attempts: 0, best: 0 };
  const enemyNodes = new Map();
  const enemyVisuals = new Map();
  const projectiles = new Set();
  const transientEffects = new Set();
  let visualTime = 0;
  let effectTime = 0;
  let endingBattle = null;
  const showingBattle = () => run?.phase === 'battle' || Boolean(endingBattle);
  const itemPulses = new Map();
  const tableLinks = new Set();
  const synergyCues = new Map();
  let tooltipAnchor = null;
  let lastPointerType = 'mouse';
  let shopMessage = '';
  let reportOrigin = null;
  const ITEM_VISUALS = {
    serviette: { color: '#b09256', symbol: '◻️', label: 'Weggewischt!', impact: '✦' },
    ventilator: { color: '#d88446', symbol: '🔥', label: 'Heiße Luft!', impact: '♨' },
    paper: { color: '#9b81bc', symbol: '📄', label: 'Ausrede!', impact: '◇' },
    headset: { color: '#528eae', symbol: '♪', label: 'Bin im Call!', impact: '⏳' },
    brotdose: { color: '#739442', symbol: '🍱', label: 'Für morgen!', impact: '↙' },
    discord: { color: '#8474c1', symbol: '💬', label: 'Voice-Call!', impact: '✦' },
    gabel: { color: '#cc8050', symbol: '🍴', label: 'Katapult!', impact: '↗' },
    kaffee: { color: '#aa774e', symbol: '☕', label: 'Kaffeepause!', impact: '◇' },
    beer: { color: '#d3a135', symbol: '🍺', label: 'Prost!', impact: '◇' },
    snus: { color: '#58a38d', symbol: '🥫', label: 'Mund besetzt!', impact: '⊘' },
    luca: { color: '#8972b2', symbol: '🎮', label: 'Bin dabei!', impact: '✦' },
    desolator: { color: '#cc4f56', symbol: '🗡️', label: 'Rüstung runter!', impact: '✕' },
    awp: { color: '#418d8c', symbol: '🎯', label: 'Sauberer Treffer!', impact: '⌖' },
    batomon: { color: '#df863f', symbol: '🔥', label: 'Typenvorteil!', impact: '✦' },
    podcast: { color: '#b88848', symbol: '🎙️', label: 'Noch ein Gedanke!', impact: '…' },
    umut: { color: '#3f9b8f', symbol: '🎨', label: 'Frisch gestrichen!', impact: '✦' },
    walkie: { color: '#7a80b0', symbol: '📡', label: 'Komme später. Over!', impact: '◇' },
    ritalin: { color: '#77bca8', symbol: '⚡', label: 'Nachbarn schneller!', impact: '⚡' },
  };

  function validRun(value) {
    if (!value || ![1, Core.VERSION].includes(value.version) || !['prep', 'battle', 'won', 'lost', ...(value.version === 1 ? ['reward'] : [])].includes(value.phase)) return false;
    if (!Number.isInteger(value.course) || value.course < 0 || value.course >= COURSES.length) return false;
    if (!Number.isFinite(value.willpower) || value.willpower < 0 || value.willpower > 100 || value.maxWillpower !== 100) return false;
    if (!Array.isArray(value.slots) || value.slots.length !== 6 || !Array.isArray(value.bench) || !value.stats) return false;
    if (![value.randomState, value.nextUid, ...['killed', 'damageDealt', 'damageTaken', 'shielded', 'coursesCleared', 'synergiesUsed'].map(key => value.stats[key])].every(Number.isFinite)) return false;
    if (![...value.slots, ...value.bench].every(item => item === null || (ITEMS[item.id] && Number.isInteger(item.level) && item.level >= 1 && item.level <= Core.MAX_LEVEL && typeof item.uid === 'string' && (value.version === 1 || (Number.isInteger(item.invested) && item.invested >= 0))))) return false;
    if (value.version === 1) {
      if (!Array.isArray(value.rewardChoices) || !value.rewardChoices.every(item => item && ITEMS[item.id])) return false;
      if (value.phase === 'reward' && value.rewardChoices.length !== 3) return false;
    } else {
      if (!Number.isInteger(value.coins) || value.coins < 0 || !value.shop || !Array.isArray(value.shop.offers) || value.shop.offers.length !== 4) return false;
      if (!Number.isInteger(value.shop.rerolls) || value.shop.rerolls < 0 || typeof value.shop.healUsed !== 'boolean' || value.shop.visit !== value.course) return false;
      if (!value.shop.offers.every(offer => offer === null || (ITEMS[offer.id] && offer.price === ITEMS[offer.id].price && typeof offer.uid === 'string' && typeof offer.locked === 'boolean'))) return false;
    }
    const battle = value.battle;
    if (value.phase === 'battle') {
      if (!battle || !Array.isArray(battle.enemies) || !Array.isArray(battle.cooldowns) || battle.cooldowns.length !== 6) return false;
      if (![battle.time, battle.spawned, battle.total, battle.killed, battle.escaped, battle.shield, battle.nextSpawn, ...battle.cooldowns].every(Number.isFinite)) return false;
      if (battle.mouthGuard !== undefined && (!Number.isFinite(battle.mouthGuard) || battle.mouthGuard < 0)) return false;
      if (!battle.enemies.every(enemy => ENEMIES[enemy.type] && typeof enemy.uid === 'string' && Number.isInteger(enemy.lane) && enemy.lane >= 0 && enemy.lane < 3 && [enemy.x, enemy.hp, enemy.maxHp, enemy.shield, enemy.speed, enemy.damage, enemy.slowUntil].every(Number.isFinite))) return false;
      if (!battle.enemies.every(enemy => enemy.vulnerableUntil === undefined || (Number.isFinite(enemy.vulnerableUntil) && enemy.vulnerableUntil >= 0))) return false;
    }
    return true;
  }

  function load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) {
        let parsed = null;
        try { parsed = JSON.parse(raw); } catch { /* A damaged save must not disable future saves. */ }
        if (validRun(parsed)) {
          const migrated = parsed.version === 1;
          const candidate = Core.migrateRun(parsed);
          if (validRun(candidate) && candidate.version === Core.VERSION) {
            run = candidate;
            if (migrated) localStorage.setItem(SAVE_KEY, JSON.stringify(run));
          } else localStorage.removeItem(SAVE_KEY);
        } else localStorage.removeItem(SAVE_KEY);
      }
      let savedRecord = null;
      try { savedRecord = JSON.parse(localStorage.getItem(RECORD_KEY) || 'null'); } catch { /* Reset malformed records. */ }
      if (savedRecord && ['wins', 'attempts', 'best'].every(key => Number.isFinite(savedRecord[key]))) record = savedRecord;
      soundEnabled = localStorage.getItem(SOUND_KEY) === 'true';
      const storedVolume = localStorage.getItem(VOLUME_KEY);
      if (storedVolume !== null && Number.isFinite(Number(storedVolume))) soundVolume = Math.max(0, Math.min(1, Number(storedVolume)));
    } catch { saveAvailable = false; }
    sound?.setVolume(soundVolume);
    sound?.setEnabled(soundEnabled);
    refreshWelcome();
    renderSound();
  }

  function save() {
    if (!run || !saveAvailable) return;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(run));
      localStorage.setItem(RECORD_KEY, JSON.stringify(record));
      lastSaved = performance.now();
    } catch {
      saveAvailable = false;
      $('save-status').textContent = 'Speichern ist in diesem Browser gerade nicht verfügbar.';
      toast('Automatisches Speichern ist nicht verfügbar. Dein Spiel läuft trotzdem weiter.');
    }
  }

  function refreshWelcome() {
    $('continue-button').hidden = !run;
    if (run) $('continue-button').innerHTML = `${['won', 'lost'].includes(run.phase) ? 'Letztes Ergebnis' : 'Versuch fortsetzen'} <span aria-hidden="true">→</span>`;
    $('new-run-button').innerHTML = `${run ? 'Neuer Versuch' : 'An den Tisch'} <span aria-hidden="true">↗</span>`;
    $('record-label').textContent = record.attempts ? `${record.wins} ${record.wins === 1 ? 'SIEG' : 'SIEGE'} · BESTLEISTUNG: ${record.best} / 6 GÄNGE` : 'GUTEN APPETIT. ODER EBEN NICHT.';
  }

  function toast(message) {
    clearTimeout(toastTimer);
    $('toast').textContent = message;
    $('toast').hidden = false;
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3500);
  }

  function playSound(cue, options = {}) {
    if (!soundEnabled || !sound || document.hidden || (showingBattle() && paused && cue !== 'ui')) return false;
    return sound.play(cue, options);
  }

  function unlockAudio() {
    if (!soundEnabled) return Promise.resolve(false);
    const generation = audioGeneration;
    const unavailable = () => {
      if (generation !== audioGeneration || !soundEnabled) return false;
      soundEnabled = false; audioUnavailable = true; sound?.setEnabled(false); renderSound();
      try { localStorage.setItem(SOUND_KEY, 'false'); } catch { /* Preferences are optional. */ }
      return false;
    };
    if (!sound) return Promise.resolve(unavailable());
    return sound.unlock().then(ready => generation === audioGeneration && soundEnabled ? ready || unavailable() : false).catch(unavailable);
  }

  function stopSounds(suspend = false) {
    audioGeneration++;
    sound?.stop();
    if (suspend) sound?.suspend().catch(() => {});
  }

  function soundPan(point) {
    return Math.max(-.65, Math.min(.65, (point.x / stageDimensions().width * 2 - 1) * .65));
  }

  function announceEncounter(encounter) {
    const key = `${run.seed}:${encounter.course}:${encounter.id}`;
    if (key === lastEncounterSound) return;
    lastEncounterSound = key;
    const generation = audioGeneration;
    if (soundEnabled) unlockAudio().then(ready => {
      if (ready && generation === audioGeneration && gameVisible && !endingBattle && Core.getEncounter(run)?.id === encounter.id) playSound('event', { eventId: encounter.id });
    });
  }

  function renderSound() {
    $('sound-label').textContent = soundEnabled ? soundVolume ? ' AN' : ' 0 %' : ' AUS';
    $('sound-button').setAttribute('aria-pressed', String(soundEnabled));
    $('sound-button').setAttribute('aria-label', soundEnabled ? 'Ton ausschalten' : 'Ton einschalten');
    $('sound-button').title = soundEnabled ? 'Ton ausschalten' : 'Ton einschalten';
    $('sound-volume').value = String(Math.round(soundVolume * 100));
    $('sound-volume-value').textContent = `${Math.round(soundVolume * 100)} %`;
    $('sound-volume-hint').textContent = audioUnavailable ? 'Dieser Browser bietet gerade keine Audioausgabe.' : soundEnabled ? 'Gilt für alle Effekte. Die Einstellung wird gespeichert.' : 'Ton über ♪ oben einschalten.';
  }

  function closeDialogs() {
    reportOrigin = null;
    $('report-toggle').setAttribute('aria-expanded', 'false');
    document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
  }

  function showGame() {
    if (!run) return;
    gameVisible = true;
    document.body.classList.add('playing');
    $('welcome').hidden = true;
    $('game').hidden = false;
    paused = run.phase === 'battle';
    if (paused) stopSounds(true);
    else unlockAudio();
    selected = null;
    render();
    window.scrollTo({ top: 0, behavior: 'instant' });
    if (['won', 'lost'].includes(run.phase)) showResult();
    else $(run.phase === 'battle' ? 'pause-button' : Core.getEncounter(run) ? 'event-title' : 'screen-title').focus({ preventScroll: true });
  }

  function startNewRun() {
    closeDialogs();
    clearCombatEffects();
    run = Core.createRun(`${Date.now()}-${Math.floor(Math.random() * 100000)}`);
    run.createdAt = Date.now();
    shopMessage = '';
    selected = null;
    paused = false;
    speed = 1;
    record.attempts++;
    save();
    showGame();
  }

  function requestNewRun() {
    if (run && !['won', 'lost'].includes(run.phase)) { stopSounds(true); $('restart-dialog').showModal(); }
    else startNewRun();
  }

  function showHome() {
    hideItemTooltip();
    clearCombatEffects();
    closeDialogs();
    if (run?.phase === 'battle') paused = true;
    stopSounds(true);
    save();
    gameVisible = false;
    document.body.classList.remove('playing');
    $('game').hidden = true;
    $('welcome').hidden = false;
    refreshWelcome();
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function getItem(index) { return index < 6 ? run.slots[index] : run.bench[index - 6]; }

  function benchOverflowHint() {
    return run.bench.length > MAX_BENCH_SIZE ? `Bank überfüllt: Vor dem Start auf ${MAX_BENCH_SIZE} Items reduzieren. Stelle Items auf den Tisch oder verkaufe sie.` : '';
  }

  function itemDefinition(itemOrId, level = 1) { return Core.getItemDefinition(itemOrId, level); }

  function itemIcon(definition) {
    return definition.iconPath ? `<img class="item-art" src="${escapeHTML(definition.iconPath)}" width="40" height="40" alt="" draggable="false">` : definition.icon;
  }

  function powerValue(stats) {
    return stats.effect === 'haste' ? stats.recharge : stats.power;
  }

  function powerLabel(stats) {
    if (stats.effect === 'haste') return 's Aufladehilfe';
    if (stats.effect === 'mouth_guard') return 'Block';
    return ['shield', 'coffee', 'refresh', 'radio'].includes(stats.effect) ? 'Schild' : 'Stärke';
  }

  function itemEffectText(stats) {
    const power = format(stats.power);
    switch (stats.effect) {
      case 'attack': return `${power} Schaden am vordersten Gericht.`;
      case 'push': return `${power} Schaden an allen Gerichten. Heiße Luft schiebt sie zurück.`;
      case 'shield': return `Baut ${power} Ausreden-Schild auf. Bis zu 35 Schild schützen Gabriels Willenskraft.`;
      case 'slow': return `${power} Schaden an allen Gerichten. Verlangsamt sie für ${format(stats.slowDuration)} s um ${Math.round((1 - stats.slowFactor) * 100)} %.`;
      case 'store': return `${power} Schaden an einem Gericht. Kleine Portionen bis ${format(stats.power * 1.3)} inklusive Käse-Schild werden vollständig eingepackt.`;
      case 'pulse': return `${power} Schaden an allen Gerichten durch einen dringenden Voice-Call.`;
      case 'fork': return `${power} Schaden an jedem der zwei vordersten Gerichte.`;
      case 'coffee': return `Gibt ${power} Ausreden-Schild. Direkt benachbarte Gegenstände sind dauerhaft 20 % stärker.`;
      case 'refresh': return `Gibt ${power} Ausreden-Schild und zieht die Aufladezeit direkter Nachbarn um ${format(stats.recharge)} s vor. Gaming-Nachbarn erhalten +20 % für ihren nächsten normalen Angriff; der Bonus stapelt nicht.`;
      case 'mouth_guard': return `Blockt bis zu ${power} Schaden des nächsten normalen Bissens, auch von Suppe. Ein Puffer, der nicht stapelt. Ein Block zieht benachbartes Bier um 2 s vor, höchstens alle 4 s. Das Dessert umgeht Snus.`;
      case 'assist': return `${power} Schaden am vordersten Gericht. Ein aufladender Gaming-Nachbar wird um ${format(stats.recharge)} s beschleunigt. Nach je 3 eigenen oder benachbarten Gaming-Aktivierungen: +10 % Stärke und Aufladehilfe, bis zu 5 Momentum.`;
      case 'mark': return `${power} Schaden am gewählten Ziel. Markiert es danach für 3 s: Folgende Treffer verursachen 25 % mehr Schaden. Markierungen stapeln nicht.`;
      case 'snipe': return `2 Schüsse mit je ${power} Schaden, 1 s auseinander. Danach ${format(stats.cooldown)} s nachladen. 50 % des Treffers umgehen Käse-Schild. Ein Abschuss eines markierten Ziels beschleunigt benachbarte Lucas um 1,5 s, höchstens alle 4 s.`;
      case 'type_attack': return `Je ${power} Schaden an zwei Zielen nach deiner Taktik. Gegen Erbsen und Brokkoli sehr effektiv: je ${format(stats.power * 2)} Schaden.`;
      case 'podcast': return `Je ${power} Schaden an den zwei vordersten Gerichten. Verlangsamt sie für ${format(stats.slowDuration)} s um ${Math.round((1 - stats.slowFactor) * 100)} %. Jeder dritte Gedanke trifft alle Gerichte und verlangsamt sie ${format(stats.finaleDuration)} s. Ohne Ziel pausiert die Diskussion.`;
      case 'paint': return `Umut entfernt bis zu ${format(stats.strip)} Käse-Schild und verursacht ${power} Schaden. Er nimmt zuerst das Gericht mit dem meisten Käse-Schild ins Visier. Der frische Lack verhindert ${format(stats.paintDuration)} s lang Nachschlag-Heilung. Erneutes Streichen frischt die Dauer auf.`;
      case 'radio': return `Gleiche Straße, direkter Draht zu Leonie: „Komme später. Over!“ Gibt ${power} Ausreden-Schild und lädt das Item auf dem gegenüberliegenden Platz um ${format(stats.recharge)} s früher auf: 1 ↔ 6, 2 ↔ 5, 3 ↔ 4. Leere Plätze und bereits bereite Items erhalten keine Aufladung.`;
      case 'haste': return `Lädt waagerecht und senkrecht angrenzende Items um bis zu ${format(stats.recharge)} s früher auf. Wirkt nur auf gerade aufladende Items am Tisch.`;
      default: return '';
    }
  }

  function itemTooltipLines(stats) {
    const power = format(stats.power);
    switch (stats.effect) {
      case 'attack': return [`${power} Schaden · vorderstes Gericht.`];
      case 'push': return [`${power} Schaden an allen Gerichten.`, 'Heißluft schiebt sie zurück.', 'Dessert: wenig Rückstoß.'];
      case 'shield': return [`+${power} Schild (max. 35).`];
      case 'slow': return [`${power} Schaden an allen Gerichten.`, `−${Math.round((1 - stats.slowFactor) * 100)} % Tempo für ${format(stats.slowDuration)} s.`];
      case 'store': return [`${power} Schaden · kleine Ziele bevorzugt.`, `Bis ${format(stats.power * 1.3)} LP inkl. Schild: einpacken (kein Boss).`];
      case 'pulse': return [`${power} Schaden an allen Gerichten.`];
      case 'fork': return [`2 vordere Ziele: je ${power} Schaden.`];
      case 'coffee': return [`+${power} Schild.`, 'Nachbarn: +20 % Stärke.'];
      case 'refresh': return [`+${power} Schild · Nachbarn ${format(stats.recharge)} s früher bereit.`, 'Gaming-Nachbarn: nächster Angriff +20 % (stapelt nicht).'];
      case 'mouth_guard': return [`Nächster Bissen: bis ${power} Block, auch Suppe.`, 'Kein Dessert. Stapelt nicht.', 'Block → Bier-Nachbarn 2 s früher (alle 4 s).'];
      case 'assist': return [`${power} Schaden · 1 Gaming-Nachbar ${format(stats.recharge)} s früher bereit.`, 'Je 3 eigene/benachbarte Gaming-Aktivierungen: +10 % Stärke und Hilfe (max. +50 %).'];
      case 'mark': return [`${power} Schaden.`, 'Markiert 3 s: Folgetreffer +25 %.'];
      case 'snipe': return [`2 × ${power} Schaden · 1 s Schussabstand.`, '50 % umgehen Käse-Schild.', 'Markierter Abschuss → Luca-Nachbarn 1,5 s früher (alle 4 s).'];
      case 'type_attack': return [`2 Ziele: je ${power} Schaden.`, `Erbsen & Brokkoli: je ${format(stats.power * 2)} Schaden.`];
      case 'podcast': return [`2 vordere Ziele: je ${power} Schaden.`, `−${Math.round((1 - stats.slowFactor) * 100)} % Tempo für ${format(stats.slowDuration)} s.`, `Jeder 3. Gedanke trifft alle; ${format(stats.finaleDuration)} s verlangsamt.`];
      case 'paint': return [`${power} Schaden · entfernt bis ${format(stats.strip)} Käse-Schild.`, 'Ziel: meistes Käse-Schild.', `Keine Heilung für ${format(stats.paintDuration)} s.`];
      case 'radio': return [`+${power} Schild.`, `Item gegenüber: ${format(stats.recharge)} s früher bereit.`];
      case 'haste': return [`Direkte Nachbarn: ${format(stats.recharge)} s früher bereit.`, 'Wirkt waagerecht und senkrecht.'];
      default: return [];
    }
  }

  function tacticSummary(state, index) {
    const tactic = Core.getTactic(state, index);
    return tactic ? `<p class="tactic-summary">Taktik: <strong>${escapeHTML(tactic.label)}</strong></p>` : '';
  }

  function radioTargetSummary(state, stats, compact = false) {
    if (stats.effect !== 'radio') return '';
    if (!Number.isInteger(stats.remoteSlot)) return compact ? '' : '<p class="tooltip-hint">Auf der Bank besteht kein Funkkontakt.</p>';
    const partner = state.slots[stats.remoteSlot];
    return `<p class="tooltip-hint">Funkpartner: Platz ${stats.remoteSlot + 1} · ${partner ? escapeHTML(itemDefinition(partner).name) : 'noch leer'}</p>`;
  }

  function tacticControls(index) {
    const choices = Core.getTactics(getItem(index));
    if (!choices.length) return '';
    const current = Core.getTactic(run, index);
    return `<div class="tactic-controls"><strong>Automatische Taktik</strong><div class="tactic-options">${choices.map(choice => `<button class="tactic-option" data-tactic="${choice.id}" data-tactic-slot="${index}" aria-pressed="${current?.id === choice.id}" title="${escapeHTML(choice.description)}" ${run.phase === 'prep' ? '' : 'disabled'}>${escapeHTML(choice.label)}</button>`).join('')}</div><p>${escapeHTML(current?.description || '')}${run.phase !== 'prep' ? ' · Vor dem nächsten Gang änderbar.' : ''}</p></div>`;
  }

  function tooltipData(anchor) {
    if (!run) return null;
    let state = run;
    let index = Number(anchor.dataset.slot);
    let item;
    let preview = false;
    if (anchor.dataset.offer !== undefined) {
      const offerIndex = Number(anchor.dataset.offer);
      const offer = run.shop.offers[offerIndex];
      const result = Core.purchasePreview(run, offerIndex);
      if (!offer) return null;
      if (!result) {
        const item = { id: offer.id, level: 1 };
        const state = { slots: [item, null, null, null, null, null], bench: [] };
        return { item, index: 0, state, preview: true, capacityBlocked: true, definition: itemDefinition(item), stats: Core.getItemStats(state, 0), price: offer.price };
      }
      return { ...result, preview: true, definition: itemDefinition(result.item), price: offer.price };
    } else {
      if (!Number.isInteger(index)) return null;
      item = getItem(index);
    }
    if (!item) return null;
    return { item, index, state, preview, definition: itemDefinition(item), stats: Core.getItemStats(state, index) };
  }

  function hideItemTooltip() {
    if (tooltipAnchor) tooltipAnchor.removeAttribute('aria-describedby');
    tooltipAnchor = null;
    $('item-tooltip').hidden = true;
  }

  function showItemTooltip(anchor) {
    const data = tooltipData(anchor);
    if (!data) { hideItemTooltip(); return; }
    const { item, index, state, preview, definition, stats, price, merges = [], capacityBlocked = false } = data;
    const active = index < 6 ? Core.getSynergies(state).filter(synergy => synergy.slots.includes(index) && (!synergy.coffee || synergy.source !== index)) : [];
    const partners = Core.getPotentialSynergies().filter(synergy => synergy.ids.includes(item.id)).map(synergy => {
      const other = itemDefinition(synergy.ids.find(id => id !== item.id));
      return `${other.icon} ${other.name}`;
    });
    const tooltip = $('item-tooltip');
    if (tooltipAnchor && tooltipAnchor !== anchor) tooltipAnchor.removeAttribute('aria-describedby');
    tooltipAnchor = anchor;
    const compactNames = (values, limit = 2) => `${values.slice(0, limit).map(escapeHTML).join(' · ')}${values.length > limit ? ` · +${values.length - limit} weitere` : ''}`;
    const headingNote = [preview ? merges.length ? 'FUSION' : 'VORSCHAU' : '', capacityBlocked ? 'BANK VOLL' : '', definition.tags?.includes('gaming') ? 'Gaming' : '', index >= 6 ? 'RESERVE · INAKTIV' : ''].filter(Boolean).join(' · ');
    tooltip.innerHTML = `<div class="tooltip-heading"><span aria-hidden="true">${itemIcon(definition)}</span><div><strong>${escapeHTML(definition.name)}</strong><small>STUFE ${item.level}${headingNote ? ` · ${headingNote}` : ''}</small></div></div><ul class="tooltip-effect tooltip-effect-lines">${itemTooltipLines(stats).map(line => `<li>${escapeHTML(line)}</li>`).join('')}</ul><div class="tooltip-stats"><strong>${format(stats.cooldown)} s</strong><span>${stats.effect === 'snipe' ? 'Nachladen' : 'Aufladung'}</span>${preview ? `<span class="tooltip-price">${price} Pfand</span>` : ''}</div>${tacticSummary(state, index)}${radioTargetSummary(state, stats, true)}${stats.episode !== undefined ? `<p class="tooltip-state">Gedanken: ${stats.episode}/${stats.episodeLength}</p>` : ''}${stats.momentum !== undefined ? `<p class="tooltip-state">Momentum: ${stats.momentum}/5 (+${stats.momentum * 10} %)</p>` : ''}${active.length ? `<p class="tooltip-synergies">Aktiv: ${compactNames(active.map(synergy => synergy.name))}</p>` : partners.length ? `<p class="tooltip-hint">Passt zu: ${compactNames(partners)}</p>` : ''}`;
    anchor.setAttribute('aria-describedby', 'item-tooltip');
    tooltip.hidden = false;
    const rect = anchor.getBoundingClientRect();
    const width = tooltip.offsetWidth || 288;
    const height = tooltip.offsetHeight || 235;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight || 800;
    let left = rect.right + 12;
    if (left + width > viewportWidth - 12) left = rect.left - width - 12;
    if (left < 12) left = Math.max(12, Math.min(viewportWidth - width - 12, rect.left));
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${Math.max(12, Math.min(viewportHeight - height - 12, rect.top - 20))}px`;
  }

  function renderTableLoadout(synergySlots) {
    $('table-loadout').innerHTML = run.slots.map((item, index) => {
      const locked = run.phase !== 'prep' || Boolean(endingBattle);
      const position = `left:${11 + index % 3 * 14}%;top:${66 + Math.floor(index / 3) * 15}%`;
      if (!item) return `<button class="table-item empty" data-slot="${index}" style="${position}" aria-label="Leerer Tischplatz ${index + 1}" ${locked ? 'disabled' : ''}><span class="table-item-number">${index + 1}</span></button>`;
      const definition = itemDefinition(item);
      return `<button class="table-item${selected === index ? ' selected' : ''}${synergySlots.has(index) ? ' synergized' : ''}" data-slot="${index}" data-effect="${definition.effect}" style="${position};--fx-color:${ITEM_VISUALS[item.id].color}" draggable="${!locked}" aria-pressed="${selected === index}" aria-label="${escapeHTML(definition.name)}, Stufe ${item.level}, Tischplatz ${index + 1}. ${escapeHTML(itemTooltipLines(Core.getItemStats(run, index)).join(' '))}"><span class="table-item-icon" aria-hidden="true">${itemIcon(definition)}</span><span class="table-item-level">${item.level}</span>${['awp', 'luca', 'podcast'].includes(item.id) ? '<span class="runtime-badge" aria-hidden="true"></span>' : ''}<span class="table-item-progress" aria-hidden="true"></span></button>`;
    }).join('');
  }

  function renderSlot(item, index, synergySlots) {
    const active = selected === index;
    const locked = showingBattle() || ['won', 'lost'].includes(run.phase);
    if (!item) return `<button class="slot empty${active ? ' selected' : ''}" data-slot="${index}" aria-label="Leerer Platz ${index + 1}${selected !== null ? ', Gegenstand hier platzieren' : ''}" ${locked ? 'disabled' : ''}><span class="slot-number">0${index + 1}</span><span class="slot-icon" aria-hidden="true">+</span><span class="slot-name">Freier Platz</span></button>`;
    const definition = itemDefinition(item);
    return `<button class="slot${active ? ' selected' : ''}${synergySlots.has(index) ? ' synergized' : ''}" data-slot="${index}" draggable="${!locked}" aria-label="${escapeHTML(definition.name)}, Stufe ${item.level}, Platz ${index + 1}. ${escapeHTML(itemTooltipLines(Core.getItemStats(run, index)).join(' '))}" aria-pressed="${active}"><span class="slot-number">${index < 6 ? `0${index + 1}` : 'BANK'}</span><span class="slot-level">LV. ${item.level}</span><span class="slot-icon" aria-hidden="true">${itemIcon(definition)}</span><span class="slot-name">${escapeHTML(definition.name)}</span>${Core.getTactic(run, index) ? `<span class="tactic-tag">${escapeHTML(Core.getTactic(run, index).label)}</span>` : ''}${index < 6 ? '<span class="slot-cooldown" aria-hidden="true"></span>' : ''}</button>`;
  }

  function renderSlots() {
    hideItemTooltip();
    const synergies = Core.getSynergies(run);
    const synergySlots = new Set(synergies.flatMap(synergy => synergy.slots));
    $('slots').innerHTML = run.slots.map((item, index) => renderSlot(item, index, synergySlots)).join('');
    $('bench').innerHTML = run.bench.map((item, index) => renderSlot(item, index + 6, synergySlots)).join('');
    $('bench-wrap').hidden = false;
    $('bench-count').textContent = `${run.bench.length} / ${MAX_BENCH_SIZE}`;
    $('bench-count').setAttribute('aria-label', `${run.bench.length} von ${MAX_BENCH_SIZE} Bankplätzen belegt`);
    $('bench-hint').textContent = benchOverflowHint();
    $('bench-hint').hidden = !benchOverflowHint();
    renderTableLoadout(synergySlots);
    $('placement-hint').textContent = selected !== null ? 'Aufwerten in den Itemdetails · unten verkaufen.' : 'Item wählen: aufwerten, verschieben, verkaufen.';
    $('synergy-count').textContent = synergies.length ? `${synergies.length} aktiv` : '';
    renderItemDetail();
    renderSellZone();
    $('synergies').innerHTML = synergies.map(synergy => `<div class="synergy"><span class="synergy-tag">AKTIV</span><strong>${escapeHTML(synergy.name)}</strong><p>${escapeHTML(synergy.description)}</p></div>`).join('');
    const potential = Core.getPotentialSynergies();
    const owned = new Set([...run.slots, ...run.bench].filter(Boolean).map(item => item.id));
    const inactive = potential.filter(synergy => !synergies.some(active => active.name === synergy.name));
    inactive.sort((a, b) => b.ids.filter(id => owned.has(id)).length - a.ids.filter(id => owned.has(id)).length);
    inactive.slice(0, Math.max(1, 2 - synergies.length)).forEach(synergy => {
      $('synergies').insertAdjacentHTML('beforeend', `<div class="synergy inactive"><strong>${synergy.ids.map(id => ITEMS[id].icon).join(' + ')} ${escapeHTML(synergy.name)}</strong><p>${escapeHTML(synergy.description)} Direkt nebeneinander platzieren.</p></div>`);
    });
    renderShop();
  }

  function upgradeControls(index) {
    if (run.phase !== 'prep' || endingBattle) return '';
    const item = getItem(index);
    if (!item) return '';
    const cost = Core.getUpgradeCost(run, index);
    if (cost === null) return `<div class="upgrade-area" id="upgrade-area"><button class="upgrade-button" id="upgrade-button" disabled>Maximale Stufe ${Core.MAX_LEVEL}</button><p id="upgrade-hint">Voll aufgewertet.</p></div>`;
    const preview = Core.upgradePreview(run, index);
    if (!preview) return '';
    const missing = Math.max(0, cost - run.coins);
    const hint = `${format(powerValue(preview.stats))} ${powerLabel(preview.stats)} · ${format(preview.stats.cooldown)} s${preview.merges.length ? ' · inklusive Fusion' : ''}${missing ? ` · ${missing} Pfand fehlen` : ''}`;
    return `<div class="upgrade-area" id="upgrade-area"><button class="upgrade-button" id="upgrade-button" data-upgrade="${index}" aria-describedby="upgrade-hint" aria-label="${escapeHTML(itemDefinition(preview.item).name)} für ${cost} Pfand auf Stufe ${preview.item.level} aufwerten" ${preview.affordable ? '' : 'disabled'}>↑ Stufe ${preview.item.level} · ${cost} Pfand</button><p id="upgrade-hint">${escapeHTML(hint)}</p></div>`;
  }

  function renderItemDetail() {
    const item = selected !== null ? getItem(selected) : null;
    $('item-detail').hidden = !item || run.phase !== 'prep' || Boolean(endingBattle);
    if (!item) { $('item-detail').innerHTML = ''; return; }
    const definition = itemDefinition(item);
    const stats = Core.getItemStats(run, selected);
    const label = powerLabel(stats);
    const partnerDetails = Core.getPotentialSynergies().filter(synergy => synergy.ids.includes(item.id)).map(synergy => {
      const partner = itemDefinition(synergy.ids.find(id => id !== item.id));
      return `<p><strong>${escapeHTML(partner.name)}:</strong> ${escapeHTML(synergy.description)}</p>`;
    }).join('');
    $('item-detail').innerHTML = `<span class="detail-icon">${itemIcon(definition)}</span><div><strong id="item-detail-name" tabindex="-1">${escapeHTML(definition.name)} · Stufe ${item.level}</strong><details class="item-more"><summary>Wirkung &amp; Hinweise</summary><p>${escapeHTML(itemEffectText(stats))}</p>${partnerDetails}</details><p class="stat-line">${format(powerValue(stats))} ${label} · ${stats.effect === 'snipe' ? 'Nachladen: ' : 'alle '}${format(stats.cooldown)} s${stats.momentum !== undefined ? ` · Momentum ${stats.momentum}/5` : ''}${selected >= 6 ? ' · Reserve: im Kampf inaktiv' : ''}</p>${radioTargetSummary(run, stats)}${upgradeControls(selected)}${tacticControls(selected)}</div>`;
  }

  function currentDraggedIndex() {
    if (!draggedItem || run?.phase !== 'prep' || endingBattle) return null;
    return getItem(draggedItem.index)?.uid === draggedItem.uid ? draggedItem.index : null;
  }

  function renderSellZone() {
    const dragIndex = currentDraggedIndex();
    const index = dragIndex ?? selected;
    const item = run && index !== null ? getItem(index) : null;
    const ready = run?.phase === 'prep' && !endingBattle;
    const button = $('sell-button');
    $('sell-zone').classList.toggle('has-selection', ready && Boolean(item));
    $('sell-zone').classList.toggle('is-dragging', dragIndex !== null);
    button.disabled = !ready || !item || dragIndex !== null;
    if (!item || !ready) {
      $('sell-hint').textContent = 'Item auswählen oder hierher ziehen.';
      button.textContent = 'Item auswählen';
      button.setAttribute('aria-label', 'Item auswählen, um es zu verkaufen');
      button.removeAttribute('data-sell');
      button.title = 'Wähle einen Gegenstand auf dem Tisch oder auf der Bank.';
      return;
    }
    const name = itemDefinition(item).name;
    const value = Core.getSellValue(run, index);
    $('sell-hint').textContent = `${dragIndex !== null ? 'Hier ablegen: ' : ''}${name} · Stufe ${item.level}${item.invested === 0 ? ' · Startausrüstung: 0 Pfand' : ''}`;
    button.textContent = dragIndex !== null ? `Ablegen · +${value} Pfand` : `Verkaufen · +${value} Pfand`;
    button.setAttribute('aria-label', `${name} für ${value} Pfand verkaufen`);
    button.title = item.invested === 0 ? 'Startausrüstung wurde nicht gekauft und bringt deshalb 0 Pfand.' : 'Du erhältst die Hälfte der investierten Münzen zurück, abgerundet.';
    if (dragIndex === null) button.setAttribute('data-sell', String(index));
    else button.removeAttribute('data-sell');
  }

  function clearItemDrag() {
    draggedItem = null;
    $('sell-zone').classList.remove('drag-over');
    document.querySelectorAll('.drag-over').forEach(node => node.classList.remove('drag-over'));
    renderSellZone();
  }

  function selectSlot(index, origin = index >= 6 ? 'bench' : 'slots') {
    if (run.phase !== 'prep' || endingBattle) return;
    unlockAudio();
    if (selected === index) selected = null;
    else if (selected !== null && Core.moveItem(run, selected, index)) {
      selected = null;
      playSound('ui');
      save();
    } else if (getItem(index)) selected = index;
    renderSlots();
    document.querySelector(`#${origin} [data-slot="${index}"]`)?.focus({ preventScroll: true });
  }

  function renderShop() {
    const shopping = run.phase === 'prep' && !endingBattle && !Core.getEncounter(run);
    $('coins-value').textContent = String(run.coins);
    $('shop-panel').hidden = !shopping;
    if (!shopping) return;
    $('shop-eyebrow').textContent = `VOR GANG ${run.course + 1} VON 6`;
    $('income-preview').textContent = `Nächster Sieg: +${Core.getCourseIncome(run.course)} Pfand`;
    $('income-preview').title = `Belohnung für Gang ${run.course + 1}. Übrige Münzen bleiben erhalten.`;
    renderFormationPreview();
    $('shop-summary').textContent = benchOverflowHint() || shopMessage || 'Item wählen zum Aufwerten · Hover für Details.';
    $('shop-offers').innerHTML = run.shop.offers.map((offer, index) => {
      if (!offer) return '<article class="shop-offer sold"><div class="offer-top"><span class="offer-icon" aria-hidden="true">✓</span><div><h3>Schon eingepackt.</h3><span class="offer-rarity">VERKAUFT</span></div></div><p class="offer-stats">Beim nächsten Reroll wieder belegt.</p><button class="button offer-buy" disabled>Vergriffen</button></article>';
      const definition = itemDefinition(offer.id);
      const preview = Core.purchasePreview(run, index);
      const capacityBlocked = !preview;
      const canBuy = !capacityBlocked && run.coins >= offer.price;
      const baseStats = Core.getItemStats({ slots: [{ id: offer.id, level: 1 }, null, null, null, null, null], bench: [] }, 0);
      const upgraded = preview && preview.merges.length > 0;
      const upgradeName = upgraded ? itemDefinition(preview.item).name : '';
      return `<article class="shop-offer ${definition.rarity}${offer.locked ? ' locked' : ''}" data-offer="${index}" data-item-id="${offer.id}" tabindex="0" aria-label="${escapeHTML(definition.name)}, ${offer.price} Pfandmünzen${offer.locked ? ', reserviert' : ''}"><div class="offer-top"><span class="offer-icon" aria-hidden="true">${itemIcon(definition)}</span><div><h3>${escapeHTML(definition.name)}</h3><span class="offer-rarity">${rarityNames[definition.rarity]}</span></div><button class="small-control offer-lock" data-lock="${index}" aria-pressed="${offer.locked}" aria-label="${offer.locked ? 'Reservierung aufheben' : 'Angebot reservieren'}: ${escapeHTML(definition.name)}" title="${offer.locked ? 'Reservierung aufheben' : 'Für Rerolls und den nächsten Gang reservieren'}">${offer.locked ? '🔒' : '◇'}</button></div><details class="offer-more"><summary>Wirkung</summary><p class="offer-description">${escapeHTML(itemEffectText(baseStats))}</p></details><p class="offer-stats">${upgraded ? `Nach Fusion: Stufe ${preview.item.level} · ` : ''}${format(powerValue(preview?.stats ?? baseStats))} ${powerLabel(baseStats)} · ${format(preview?.stats.cooldown ?? baseStats.cooldown)} s</p>${upgraded || preview?.index >= 6 ? `<p class="offer-upgrade">${upgraded ? `↑ ${escapeHTML(upgradeName)} · Stufe ${preview.item.level}` : '+ Auf die Bank'}</p>` : ''}<button class="button offer-buy" data-buy="${index}" ${canBuy ? '' : 'disabled'} aria-label="${escapeHTML(definition.name)}${capacityBlocked ? ': Bank voll' : ` für ${offer.price} Pfandmünzen kaufen`}" title="${capacityBlocked ? 'Bank voll: Stelle ein Item auf den Tisch oder verkaufe es. Fusionen bleiben möglich.' : canBuy ? 'Gegenstand kaufen' : 'Zu wenig Pfandmünzen'}">${capacityBlocked ? 'Bank voll' : 'Kaufen'} <span>${offer.price} 🪙</span></button></article>`;
    }).join('');
    const rerollCost = Core.getRerollCost(run);
    const allLocked = run.shop.offers.every(offer => offer?.locked);
    $('reroll-price').textContent = `${rerollCost} ${rerollCost === 1 ? 'Pfandmünze' : 'Pfandmünzen'}`;
    $('reroll-button').disabled = allLocked || run.coins < rerollCost;
    $('reroll-button').title = allLocked ? 'Alle vier Angebote sind reserviert.' : 'Nur unreservierte Angebote werden ersetzt.';
    $('heal-button').disabled = run.shop.healUsed || run.willpower >= run.maxWillpower || run.coins < 4;
    $('heal-price').textContent = run.shop.healUsed ? 'In diesem Shop bereits genutzt' : run.willpower >= run.maxWillpower ? 'Willenskraft ist bereits voll' : '+15 Willenskraft · 4 Münzen';
    $('shop-serve-button').innerHTML = `Gang ${run.course + 1} starten <span aria-hidden="true">→</span>`;
    const canStart = run.slots.some(Boolean) && run.bench.length <= MAX_BENCH_SIZE;
    $('shop-serve-button').disabled = !canStart;
    $('shop-serve-button').title = benchOverflowHint();
    $('serve-button').disabled = !canStart;
  }

  function renderFormationPreview() {
    const { formation, rule } = Core.getBattlePlan(run);
    $('formation-overview').innerHTML = `<span class="formation-icon" aria-hidden="true">${formation.icon}</span><div class="formation-copy"><span class="eyebrow">NÄCHSTER GEGNER · GANG ${run.course + 1}</span><strong>${escapeHTML(formation.name)}</strong><p>${escapeHTML(rule || formation.description)}</p></div>`;
  }

  function renderNotebook() {
    const plan = Core.getBattlePlan(run);
    const counts = new Map();
    plan.enemyTypes.forEach(type => counts.set(type, (counts.get(type) || 0) + 1));
    $('notebook-content').innerHTML = `<div class="enemy-preview-title">${plan.total} GERICHTE · ${format(plan.spawnEvery)} S TAKT</div><div class="formation-threats">${[...counts].map(([type, count]) => `<span>${ENEMIES[type].icon} ${count}× ${escapeHTML(ENEMIES[type].name)}</span>`).join('')}</div><p class="formation-tip">${escapeHTML(plan.formation.tip)}</p>`;
  }

  function renderScreens() {
    const encounter = run.phase === 'prep' && !endingBattle ? Core.getEncounter(run) : null;
    const shopping = run.phase === 'prep' && !endingBattle && !encounter;
    const course = endingBattle?.report?.course ?? run.course;
    $('game').dataset.screen = encounter ? 'event' : shopping ? 'shop' : 'battle';
    $('event-screen').hidden = !encounter;
    $('shop-screen').hidden = !shopping;
    $('battle-screen').hidden = shopping || Boolean(encounter);
    $('event-screen').setAttribute('aria-hidden', String(!encounter));
    $('shop-screen').setAttribute('aria-hidden', String(!shopping));
    $('battle-screen').setAttribute('aria-hidden', String(shopping || Boolean(encounter)));
    $('prep-vitals').hidden = !shopping && !encounter;
    $('run-wallet').hidden = !shopping && !encounter;
    $('screen-title').textContent = encounter ? 'Zwischenfall' : shopping ? 'Pfandladen' : showingBattle() ? 'Am Tisch' : 'Menü beendet';
    $('run-eyebrow').textContent = `GANG ${course + 1} / 6${showingBattle() && paused ? ' · PAUSIERT' : ''}`;
  }

  function renderEncounter() {
    const encounter = Core.getEncounter(run);
    if (encounter) {
      $('event-title').textContent = encounter.title;
      $('event-icon').textContent = encounter.icon;
      $('event-description').textContent = encounter.description;
      $('event-quote').textContent = encounter.quote;
      $('event-progress').textContent = `${encounter.progress} / ${encounter.total}`;
      $('event-choices').innerHTML = encounter.choices.map(choice => `<button class="event-choice" data-event-choice="${escapeHTML(choice.id)}" ${choice.affordable ? '' : 'disabled'} aria-label="${escapeHTML(`${choice.label}. ${choice.effectText}${choice.disabledReason ? `. ${choice.disabledReason}` : ''}`)}"><strong class="event-choice-label">${escapeHTML(choice.label)}</strong><span class="event-choice-effect">${escapeHTML(choice.effectText)}${choice.disabledReason ? ` · ${escapeHTML(choice.disabledReason)}` : ''}</span></button>`).join('');
      $('event-hint').textContent = 'Wähle eine Antwort. Danach geht es in den Shop.';
      if (gameVisible && !endingBattle) announceEncounter(encounter);
    }
    const buff = Core.getEventBuff(run);
    for (const id of ['shop-event-buffs', 'battle-event-buffs']) {
      const container = $(id);
      container.hidden = !buff;
      container.innerHTML = buff ? `<span class="event-buff"><strong>${id === 'shop-event-buffs' ? 'Nächster Gang' : 'Dieser Gang'} · ${escapeHTML(buff.label)}</strong><span>${escapeHTML(buff.description)}</span></span>` : '';
    }
  }

  function openReport(origin = 'round') {
    if (!run || showingBattle() || !Core.getBattleReport(run)) return;
    hideItemTooltip();
    stopSounds(true);
    if (origin === 'result') $('result-dialog').close();
    reportOrigin = origin;
    renderReport();
    $('report-toggle').setAttribute('aria-expanded', 'true');
    if (!$('report-dialog').open) $('report-dialog').showModal();
    $('report-close-button').focus({ preventScroll: true });
  }

  function renderReport() {
    const report = Core.getBattleReport(run);
    $('battle-report-panel').hidden = !report;
    $('result-report-button').hidden = !report;
    $('round-recap').hidden = !report || showingBattle() || Boolean(Core.getEncounter(run));
    if (!report) return;
    $('report-eyebrow').textContent = `GANG ${report.course + 1} · ${report.formationName}`;
    $('report-body').hidden = false;
    const outcome = run.lastBattle.income > 0 ? 'geschafft' : 'beendet';
    $('round-recap-text').textContent = `Gang ${report.course + 1} ${outcome} · +${run.lastBattle.income} Pfand · −${format(report.damageTaken)} Willenskraft`;
    const value = number => format(Number(number) || 0);
    const leaks = report.leaks || [];
    const chains = report.chains || [];
    $('report-body').innerHTML = `<div class="report-summary"><div><strong>${value(report.duration)} s</strong><span>KAMPFDAUER</span></div><div><strong>${report.killed}</strong><span>ABGEWEHRT</span></div><div><strong>${report.escaped}</strong><span>DURCHGEKOMMEN</span></div><div><strong>−${value(report.damageTaken)}</strong><span>WILLENSKRAFT</span></div></div><div class="report-grid"><div class="report-insights"><h3 class="report-subheading">Für deinen nächsten Aufbau</h3>${(report.insights || []).map(insight => `<p>${escapeHTML(insight)}</p>`).join('')}<div class="report-leaks"><strong>Bei Gabriel angekommen</strong>${leaks.length ? leaks.map(leak => `<p>${ENEMIES[leak.type]?.icon || ''} ${leak.count}× ${escapeHTML(ENEMIES[leak.type]?.name || leak.type)} · ${value(leak.damage)} Schaden</p>`).join('') : '<p>Kein Gericht hat Gabriel erreicht.</p>'}</div></div><div class="report-chains"><h3 class="report-subheading">Deine Auslöserketten</h3>${chains.length ? chains.map(chain => `<p data-report-chain="${escapeHTML(chain.id)}"><strong>${chain.count}× ${escapeHTML(chain.name)}</strong></p>`).join('') : '<p class="report-empty">Keine Kette ausgelöst. Prüfe Nachbarn, Zielwahl und Timing.</p>'}</div></div><div class="report-table-wrap"><table class="report-table"><caption>Beiträge der Gegenstände auf deinem Tisch. Schaden zählt tatsächlich entfernte Lebenspunkte und Käse-Schild; Überschuss ist Schaden über die verbleibende Portion hinaus.</caption><thead><tr><th scope="col">Gegenstand / Taktik</th><th scope="col">Aktivierungen</th><th scope="col">Schaden</th><th scope="col">Überschuss</th><th scope="col">Abschüsse</th><th scope="col">Schild / Block</th><th scope="col">Aufladung</th><th scope="col">Wartezeit</th></tr></thead><tbody>${(report.items || []).map(item => `<tr data-report-item="${escapeHTML(item.uid)}"><th scope="row">${escapeHTML(itemDefinition(item)?.name || item.name)} · Stufe ${item.level}${item.tacticLabel ? `<small>${escapeHTML(item.tacticLabel)}</small>` : ''}</th><td>${item.activations}</td><td>${value(item.damage)}</td><td>${value(item.overkill)}</td><td>${item.kills}</td><td title="Aufgebauter Schild / tatsächlich geblockter Schaden">${value(item.shield)} / ${value(item.blocked)}</td><td>${value(item.recharge)} s</td><td title="Zeit mit fertiger Aufladung ohne passendes Ziel">${value(item.idleTime)} s</td></tr>`).join('')}</tbody></table></div>`;
  }

  function render() {
    if (!run) return;
    const course = COURSES[run.course];
    const plan = Core.getBattlePlan(run);
    $('course-track').innerHTML = COURSES.map((entry, index) => {
      const name = index === run.course ? plan.formation.name : Core.FORMATIONS[run.formationPlan?.[index]]?.name || entry.name;
      return `<span class="course-dot${index < run.stats.coursesCleared ? ' done' : index === run.course ? ' current' : ''}${index === 5 ? ' boss' : ''}" title="Gang ${index + 1}: ${escapeHTML(name)}" aria-label="Gang ${index + 1}: ${escapeHTML(name)}${index < run.stats.coursesCleared ? ', geschafft' : index === run.course ? ', aktuell' : ''}" ${index === run.course ? 'aria-current="step"' : ''}>${index < run.stats.coursesCleared ? '✓' : index === 5 ? '✳' : `0${index + 1}`}</span>`;
    }).join('');
    $('course-number').innerHTML = `0${run.course + 1}<span>/ 06</span>`;
    $('course-subtitle').textContent = run.course === 5 ? 'DAS GROSSE DESSERT-FINALE' : `${['ERSTER', 'ZWEITER', 'DRITTER', 'VIERTER', 'FÜNFTER'][run.course]} GANG`;
    $('course-name').textContent = plan.formation.name;
    $('leonie-quote').textContent = plan.formation.quote || course.quote;
    renderSlots(); renderNotebook(); renderEncounter(); renderControls(); renderBattle(); renderHUD(); renderReport();
    if (!saveAvailable) $('save-status').textContent = 'Speichern ist in diesem Browser gerade nicht verfügbar.';
  }

  function renderControls() {
    renderScreens();
    const battle = showingBattle();
    $('pause-button').disabled = !battle;
    $('pause-button').textContent = paused ? '▶' : 'Ⅱ';
    $('pause-button').setAttribute('aria-label', paused ? 'Kampf fortsetzen' : 'Kampf pausieren');
    $('speed-button').textContent = `${speed}×`;
    $('speed-button').setAttribute('aria-label', `Geschwindigkeit ${speed}-fach. Klicken zum Ändern.`);
    $('paused-sticker').hidden = !(battle && paused);
    $('battle-stage').classList.toggle('effects-paused', battle && paused);
    $('battle-stage').style.setProperty('--combat-rate', String(speed));
    $('game').classList.toggle('combat-paused', battle && paused);
    $('game').style.setProperty('--combat-rate', String(speed));
    $('serve-button').hidden = (run.phase === 'prep' && !endingBattle) || (battle && !paused);
    $('serve-button').classList.toggle('fighting', battle && !paused);
    $('serve-button').disabled = (battle && !paused) || (!battle && run.phase === 'prep' && (!run.slots.some(Boolean) || run.bench.length > MAX_BENCH_SIZE || Boolean(Core.getEncounter(run))));
    if (run.phase === 'prep' && !endingBattle) $('serve-button').innerHTML = `Gang ${run.course + 1} starten <span aria-hidden="true">→</span>`;
    else if (battle) $('serve-button').innerHTML = paused ? 'Kampf fortsetzen <span aria-hidden="true">▶</span>' : 'Deine Ausreden übernehmen. <span aria-hidden="true">✳</span>';
    else $('serve-button').innerHTML = 'Ergebnis ansehen <span aria-hidden="true">→</span>';
    const message = $('arena-message');
    message.hidden = battle;
    if (!battle) {
      const content = run.phase === 'prep' ? run.lastBattle ? ['🪙', `Gang geschafft. +${run.lastBattle.income} Münzen.`, 'Vor dem Nachschlag noch in den Pfandladen.'] : ['✳', 'Erst mal einkaufen.', 'Deine Pfandmünzen warten auf gute Ausreden.'] : run.phase === 'won' ? ['✳', 'Gabel gibt nicht nach.', 'Gabriel hat noch immer keinen Hunger.'] : ['…', 'Gabel greift zu.', 'Leonie gewinnt diese Runde.'];
      message.innerHTML = `<span>${content[0]}</span><h3>${content[1]}</h3><p>${content[2]}</p>`;
    }
  }

  function ensureEnemyVisual(enemy) {
    let visual = enemyVisuals.get(enemy.uid);
    if (!visual) {
      const node = document.createElement('div');
      node.dataset.enemyUid = enemy.uid;
      node.innerHTML = '<span class="enemy-icon"></span><span class="enemy-name"></span><span class="enemy-role"></span><div class="enemy-health"><i></i></div>';
      node.querySelector('.enemy-health>i').style.width = `${enemyHealthPercent(enemy)}%`;
      $('enemy-layer').append(node);
      visual = { node, enemy: { ...enemy }, pending: 0, vanished: false, destroyed: Boolean(enemy.destroyed), defeatedAt: null, hitUntil: 0 };
      enemyNodes.set(enemy.uid, node);
      enemyVisuals.set(enemy.uid, visual);
    }
    return visual;
  }

  function enemyHealthPercent(enemy) {
    return Math.max(0, Math.min(100, (enemy.hp || 0) / Math.max(1, enemy.maxHp || 0) * 100));
  }

  function drawEnemyVisual(visual) {
    const { node, enemy, vanished, pending } = visual;
    const battleTime = (run.battle || endingBattle)?.time || 0;
    node.className = `enemy${enemy.boss ? ' boss' : ''}${enemy.support ? ' support' : ''}${Number(node.dataset.healUntil || 0) > visualTime ? ' healing' : ''}${enemy.slowUntil > battleTime ? ' slowed' : ''}${(enemy.vulnerableUntil || 0) > battleTime ? ' marked' : ''}${(enemy.paintUntil || 0) > battleTime ? ' painted' : ''}${visual.hitUntil > visualTime ? ' is-hit' : ''}${vanished && pending > 0 ? ' pending-defeat' : ''}${visual.defeatedAt !== null ? ' is-defeated' : ''}`;
    node.style.left = `${Math.max(0, Math.min(1.04, enemy.x)) * 100}%`;
    node.style.top = `${18 + enemy.lane * 31}%`;
    node.querySelector('.enemy-icon').textContent = enemy.icon;
    node.querySelector('.enemy-name').textContent = enemy.boss ? 'DESSERT-BOSS' : enemy.name;
    node.querySelector('.enemy-role').textContent = enemy.support ? 'HEILT VERBÜNDETE' : '';
    node.querySelector('.enemy-role').hidden = !enemy.support;
    node.querySelector('.enemy-health>i').style.width = `${visual.destroyed || visual.defeatedAt !== null ? 0 : enemyHealthPercent(enemy)}%`;
    node.title = `${enemy.name}${enemy.support ? ' · Unterstützer: heilt andere Gerichte' : ''}: ${Math.ceil(enemy.hp)} Portionen${enemy.shield > 0 ? ` + ${Math.ceil(enemy.shield)} Käse-Schild` : ''}${(enemy.vulnerableUntil || 0) > battleTime ? ' · Markiert: +25 % Folgeschaden' : ''}${(enemy.paintUntil || 0) > battleTime ? ` · Frisch gestrichen: keine Heilung für ${format(enemy.paintUntil - battleTime)} s` : ''}`;
  }

  function retainTarget(target) {
    const live = run.battle?.enemies.find(enemy => enemy.uid === target.uid);
    const definition = ENEMIES[target.type];
    const previous = enemyVisuals.get(target.uid);
    const snapshot = live || { ...definition, shield: 0, slowUntil: 0, vulnerableUntil: 0, ...previous?.enemy, ...target,
      hp: target.destroyed || previous?.destroyed ? 0 : target.hp ?? previous?.enemy.hp ?? 0,
      maxHp: target.maxHp ?? previous?.enemy.maxHp ?? definition.hp };
    const visual = previous || ensureEnemyVisual(snapshot);
    visual.enemy = { ...snapshot };
    visual.destroyed ||= Boolean(target.destroyed);
    if (visual.destroyed) visual.enemy.hp = 0;
    if (!live) {
      visual.enemy.x = target.x;
      visual.enemy.lane = target.lane;
      visual.vanished = true;
    }
    visual.pending++;
    visual.defeatedAt = null;
    drawEnemyVisual(visual);
    return visual;
  }

  function renderBattle(prune = true) {
    const enemies = run.battle?.enemies || [];
    const live = new Set(enemies.map(enemy => enemy.uid));
    for (const enemy of enemies) {
      const visual = ensureEnemyVisual(enemy);
      visual.enemy = { ...enemy };
      if (visual.destroyed) visual.enemy.hp = 0;
      visual.vanished = false;
    }
    for (const [uid, visual] of enemyVisuals) {
      if (!live.has(uid)) {
        visual.vanished = true;
        // Escaped dishes have no confirmed impact to animate.
        if (prune && visual.pending === 0 && visual.defeatedAt === null) {
          visual.node.remove(); enemyNodes.delete(uid); enemyVisuals.delete(uid);
          continue;
        }
      }
      if (visual.defeatedAt !== null && visualTime - visual.defeatedAt >= .22) {
        visual.node.remove(); enemyNodes.delete(uid); enemyVisuals.delete(uid);
      } else drawEnemyVisual(visual);
    }
    const runtime = (run.battle || endingBattle)?.itemRuntime;
    document.querySelectorAll('#table-loadout [data-slot]').forEach(node => {
      node.classList.toggle('has-focus', showingBattle() && Boolean(runtime?.[Number(node.dataset.slot)]?.focus));
    });
  }

  function renderHUD() {
    const battle = run.battle || endingBattle;
    const willpower = Math.ceil(run.willpower);
    $('willpower-value').textContent = `${willpower} / ${run.maxWillpower}`;
    $('prep-willpower').textContent = String(willpower);
    $('willpower-fill').style.width = `${Math.max(0, run.willpower)}%`;
    $('willpower-meter').classList.toggle('low', run.willpower < 35);
    $('willpower-meter').setAttribute('aria-valuenow', String(willpower));
    $('willpower-note').textContent = willpower > 70 ? 'Noch vollkommen überzeugt, dass er keinen Hunger hat.' : willpower > 35 ? '„Vielleicht nur dran riechen?“ – Nein. Konzentrier dich.' : willpower > 0 ? 'Die Ausreden werden dünn. Sehr dünn.' : '„Na gut. Einen Bissen.“';
    $('shield-value').textContent = Math.round(battle?.shield || 0);
    const guard = showingBattle() ? battle?.mouthGuard || 0 : 0;
    $('mouth-guard-badge').hidden = guard <= 0;
    const guardText = `Snus: ${format(guard)} Block bereit`;
    if ($('mouth-guard-badge').textContent !== guardText) $('mouth-guard-badge').textContent = guardText;
    $('defeated-value').textContent = `${battle?.killed || 0} / ${battle?.total || Core.getBattlePlan(run).total}`;
    if (showingBattle()) document.querySelectorAll('#slots .slot-cooldown, #table-loadout .table-item-progress').forEach(node => {
      const index = Number(node.closest('[data-slot]').dataset.slot);
      const stats = Core.getItemStats(run, index);
      node.style.width = `${stats ? 100 * Math.max(0, 1 - battle.cooldowns[index] / (battle.cooldownMax?.[index] || stats.cooldown)) : 0}%`;
    });
    document.querySelectorAll('#table-loadout .runtime-badge').forEach(node => {
      const index = Number(node.closest('[data-slot]').dataset.slot);
      const item = run.slots[index];
      const runtime = battle?.itemRuntime?.[index];
      node.textContent = item.id === 'awp' ? `${runtime?.shotsRemaining ?? 2}/2` : item.id === 'podcast' ? `${runtime?.episode || 0}/3` : `+${(runtime?.momentum || 0) * 10} %`;
      node.title = item.id === 'awp' ? 'Schüsse bis zur Nachladepause' : item.id === 'podcast' ? `Gedanken: ${runtime?.episode || 0}/3. Der nächste dritte Gedanke trifft alle Gerichte.` : `Luca: ${runtime?.momentum || 0}/5 Momentum`;

    });
    if (tooltipAnchor && run.phase === 'battle') showItemTooltip(tooltipAnchor);
  }

  function addEffect(text, x, lane, style = '') {
    if ($('effect-layer').children.length > 25) return;
    const node = document.createElement('span');
    node.className = `floating-effect ${style}`;
    node.textContent = text;
    node.style.left = `${Math.max(1, Math.min(97, x * 100))}%`;
    node.style.top = `${12 + lane * 31}%`;
    $('effect-layer').append(node);
    transientEffects.add({ node, expires: effectTime + .85 });
  }

  function clearCombatEffects() {
    stopSounds();
    pendingResultSound = null;
    for (const pulse of itemPulses.values()) pulse.node.classList.remove(pulse.className);
    itemPulses.clear();
    tableLinks.clear();
    synergyCues.clear();
    draggedItem = null;
    $('sell-zone').classList.remove('drag-over');
    projectiles.clear();
    transientEffects.clear();
    endingBattle = null;
    visualTime = 0;
    effectTime = 0;
    enemyNodes.forEach(node => node.remove());
    enemyNodes.clear();
    enemyVisuals.clear();
    $('combat-fx-layer').replaceChildren();
    $('effect-layer').replaceChildren();
    $('chain-feed').replaceChildren();
  }

  function stageDimensions() {
    // Every FX position uses this layer's content origin, including stage borders.
    const rect = $('combat-fx-layer').getBoundingClientRect();
    return { rect, width: rect.width || rect.right - rect.left || 600, height: rect.height || rect.bottom - rect.top || 380 };
  }

  function elementCenter(node) {
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    const width = rect.width || rect.right - rect.left;
    const height = rect.height || rect.bottom - rect.top;
    if (!(width > 0 && height > 0)) return null;
    const origin = stageDimensions().rect;
    return { x: rect.left - origin.left + width / 2, y: rect.top - origin.top + height / 2 };
  }

  function sourceCoordinates(index) {
    const stage = stageDimensions();
    const node = document.querySelector(`#table-loadout [data-slot="${index}"]`);
    return elementCenter(node?.querySelector('.table-item-icon')) || elementCenter(node) || { x: stage.width * (.11 + index % 3 * .14), y: stage.height * (.66 + Math.floor(index / 3) * .15) };
  }

  function targetCoordinates(target) {
    const actual = elementCenter(enemyNodes.get(target.uid)?.querySelector('.enemy-icon'));
    if (actual) return actual;
    const stage = stageDimensions();
    const layer = $('enemy-layer').getBoundingClientRect();
    const width = layer.width || layer.right - layer.left || stage.width * .73;
    const height = layer.height || layer.bottom - layer.top || stage.height * .39;
    return { x: layer.left - stage.rect.left + Math.max(0, Math.min(1.04, target.x)) * width, y: layer.top - stage.rect.top + (.18 + target.lane * .31) * height };
  }

  function createCombatEffect(className, point, color, duration = 1000) {
    if ($('combat-fx-layer').children.length >= 100) return null;
    const node = document.createElement('span');
    node.className = className;
    node.style.left = `${point.x}px`;
    node.style.top = `${point.y}px`;
    node.style.setProperty('--fx-color', color);
    $('combat-fx-layer').append(node);
    if (duration > 0) transientEffects.add({ node, expires: effectTime + duration / 1000 });
    return node;
  }

  function pointFeedback(text, point, style = '') {
    const node = createCombatEffect(`floating-effect impact-number ${style}`, { x: point.x, y: point.y - 18 }, '#263e35', 850);
    if (node) node.textContent = text;
  }

  const SUPPORT_VISUALS = {
    beer: { color: '#d3a135', symbol: '○' }, luca: { color: '#8972b2', symbol: '↗' },
    coffee: { color: '#aa774e', symbol: '☕' }, radio: { color: '#7a80b0', symbol: '⌁' },
    haste: { color: '#58a990', symbol: 'ϟ' },
  };
  const CHAIN_VISUALS = {
    marked_finish: { color: '#c34e60', symbol: '⌖' }, snus_beer: { color: '#45a48c', symbol: '🍺' },
    beer_focus: { color: '#d3a135', symbol: '⌖' }, gaming_rhythm: { color: '#8972b2', symbol: '↑' },
    podcast_finale: { color: '#b88848', symbol: 'Ⅲ' },
  };

  function positionTableLink(link) {
    const from = sourceCoordinates(link.sourceSlot), to = sourceCoordinates(link.targetSlot);
    link.node.style.left = `${from.x}px`;
    link.node.style.top = `${from.y}px`;
    link.node.style.width = `${Math.hypot(to.x - from.x, to.y - from.y)}px`;
    link.node.style.setProperty('--flight-angle', `${Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI}deg`);
  }

  function connectItems(sourceSlot, targetSlot, options) {
    if (!Number.isInteger(sourceSlot) || !Number.isInteger(targetSlot) || !run.slots[sourceSlot] || !run.slots[targetSlot]) return;
    const { className, impactClass, color, symbol, kind, chain, synergy, duration = .55, role = 'link', drain = false } = options;
    const stamp = (node, effectRole) => {
      node.dataset.sourceSlot = String(sourceSlot); node.dataset.targetSlot = String(targetSlot);
      node.dataset.effectRole = effectRole;
      if (kind) node.dataset.kind = kind;
      if (chain) node.dataset.chain = chain;
      if (synergy) node.dataset.synergy = synergy;
    };
    if (sourceSlot !== targetSlot) {
      const node = createCombatEffect(className, sourceCoordinates(sourceSlot), color, 0);
      if (node) {
        stamp(node, role);
        const marker = document.createElement('span'); marker.className = 'link-symbol'; marker.textContent = symbol;
        node.append(marker);
        const link = { node, sourceSlot, targetSlot, expires: visualTime + duration, drain };
        tableLinks.add(link); positionTableLink(link);
      }
    }
    if (impactClass) {
      const node = createCombatEffect(impactClass, sourceCoordinates(targetSlot), color, 0);
      if (node) {
        stamp(node, role === 'link' ? 'recipient' : `${role}-recipient`);
        if (kind !== 'haste') node.textContent = symbol;
        transientEffects.add({ node, expires: visualTime + duration, combatClock: true, anchorSlot: targetSlot, drain });
      }
    }
  }

  function updateTableLinks() {
    for (const link of tableLinks) {
      if (visualTime >= link.expires) { link.node.remove(); tableLinks.delete(link); }
      else positionTableLink(link);
    }
  }

  function animatePassiveSynergies(index) {
    for (const synergy of Core.getSynergies(run)) {
      if (!synergy.slots.includes(index) || (synergy.coffee && synergy.source === index)) continue;
      const kind = synergy.coffee ? 'coffee' : synergy.cooldown !== 1 ? 'cooldown' : 'power';
      const partners = synergy.coffee ? [synergy.source] : synergy.slots.filter(slot => slot !== index);
      for (const partner of partners) {
        const key = `${synergy.name}:${partner}:${index}`;
        if ((synergyCues.get(key) || 0) > visualTime) continue;
        synergyCues.set(key, visualTime + .45);
        connectItems(partner, index, { className: 'synergy-link', kind, synergy: synergy.name, role: 'synergy',
          color: kind === 'coffee' ? '#aa774e' : kind === 'cooldown' ? '#4796ad' : '#c69942',
          symbol: kind === 'coffee' ? '☕' : kind === 'cooldown' ? '⏱' : '✦' });
      }
    }
  }

  function pulseItem(node, className, duration) {
    if (!node) return;
    node.classList.remove(className); void node.offsetWidth; node.classList.add(className);
    const key = `${node.closest('#table-loadout') ? 'table' : 'inventory'}:${node.dataset.slot}:${className}`;
    itemPulses.set(key, { node, className, expires: visualTime + duration });
  }

  function updateItemPulses() {
    for (const [key, pulse] of itemPulses) if (visualTime >= pulse.expires) {
      pulse.node.classList.remove(pulse.className); itemPulses.delete(key);
    }
  }

  function launchProjectile(itemId, slot, target, icon, color, effect, extra = {}) {
    const reverse = effect === 'store';
    if (target) retainTarget(target);
    const from = reverse ? targetCoordinates(target) : sourceCoordinates(slot);
    const to = target ? reverse ? sourceCoordinates(slot) : targetCoordinates(target) : gabrielCoordinates();
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const node = createCombatEffect(`item-projectile fx-${itemId}${reduced ? ' motion-reduced' : ''}`, from, color, 0);
    const flight = { node, itemId, slot, target, icon, color, effect, reverse, born: visualTime, duration: reduced ? 0 : Math.max(.1, Math.min(.28, Math.hypot(to.x - from.x, to.y - from.y) / 2200)), feedback: [], ...extra };
    if (node) {
      node.dataset.slot = String(slot);
      if (target) node.dataset.enemyUid = target.uid;
      node.dataset.state = 'flying';
      node.dataset.duration = String(flight.duration);
      const symbol = document.createElement('span');
      symbol.className = 'projectile-icon';
      if (itemId === 'serviette' && !reverse) symbol.innerHTML = itemIcon(itemDefinition(itemId));
      else symbol.textContent = icon;
      node.append(symbol);
    }
    projectiles.add(flight);
    positionProjectile(flight, 0);
    return flight;
  }

  function positionProjectile(flight, progress) {
    const from = flight.reverse ? targetCoordinates(flight.target) : sourceCoordinates(flight.slot);
    const to = flight.target ? flight.reverse ? sourceCoordinates(flight.slot) : targetCoordinates(flight.target) : gabrielCoordinates();
    flight.from = from; flight.to = to;
    const node = flight.node;
    if (!node) return;
    const blend = 1 - (1 - progress) * (1 - progress);
    node.style.left = `${from.x + (to.x - from.x) * blend}px`;
    node.style.top = `${from.y + (to.y - from.y) * blend}px`;
    node.style.setProperty('--start-x', `${from.x}px`);
    node.style.setProperty('--start-y', `${from.y}px`);
    node.style.setProperty('--target-x', `${to.x}px`);
    node.style.setProperty('--target-y', `${to.y}px`);
    node.style.setProperty('--travel-x', `${to.x - from.x}px`);
    node.style.setProperty('--travel-y', `${to.y - from.y}px`);
    node.style.setProperty('--flight-angle', `${Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI}deg`);
    node.dataset.elapsed = String(Math.max(0, visualTime - flight.born));
  }

  function arriveProjectile(flight) {
    const { target, effect, color, slot } = flight;
    const point = flight.to;
    if (flight.node) flight.node.dataset.state = 'arrived';
    if (target) {
      const impact = createCombatEffect(`target-impact${flight.effective ? ' type-effective' : ''}`, point, color, 450);
      if (impact) {
        impact.dataset.effect = effect; impact.dataset.effectRole = 'target'; impact.dataset.enemyUid = target.uid;
        if (flight.effective) impact.dataset.effectiveness = 'super';
        const symbol = document.createElement('span'); symbol.className = 'impact-symbol'; symbol.textContent = ITEM_VISUALS[flight.itemId].impact; impact.append(symbol);
      }
      const visual = enemyVisuals.get(target.uid);
      if (visual) {
        visual.pending = Math.max(0, visual.pending - 1);
        visual.hitUntil = visualTime + .14;
        if (visual.vanished && visual.pending === 0) visual.defeatedAt = visualTime;
        drawEnemyVisual(visual);
      }
      if (flight.effective) pointFeedback('Sehr effektiv!', point, 'effective');
      if (effect === 'mark') createCombatEffect('armor-break', point, color);
      if (effect === 'paint') {
        const splash = createCombatEffect('paint-splash', point, color, 700);
        if (splash) splash.dataset.enemyUid = target.uid;
      }
      if (effect === 'snipe') {
        const tracer = createCombatEffect('snipe-tracer', flight.from, color, 220);
        if (tracer) {
          tracer.style.width = `${Math.hypot(point.x - flight.from.x, point.y - flight.from.y)}px`;
          tracer.style.setProperty('--flight-angle', `${Math.atan2(point.y - flight.from.y, point.x - flight.from.x) * 180 / Math.PI}deg`);
          tracer.dataset.enemyUid = target.uid;
        }
      }
    } else if (['shield', 'coffee', 'refresh', 'radio'].includes(effect)) {
      createCombatEffect('shield-aura', point, color);
    }
    for (const event of flight.feedback) {
      if (event.type === 'chain') animateChain(event);
      if (event.type === 'attack') {
        pointFeedback(`−${event.amount}`, point);
        playSound('impact', { itemId: flight.itemId, effect, level: flight.level, pan: soundPan(point), effective: flight.effective, killed: flight.feedback.some(feedback => feedback.type === 'kill') });
      }
      if (event.type === 'kill') pointFeedback('✳', point);
      if (event.type === 'shield' && event.amount > 0) { pointFeedback(`+${event.amount} ◇`, point, 'shield'); playSound('shield', { itemId: flight.itemId, effect, pan: soundPan(point) }); }
    }
    flight.node?.remove();
    projectiles.delete(flight);
  }

  function updateProjectiles() {
    for (const flight of [...projectiles]) {
      const age = Math.max(0, visualTime - flight.born);
      const progress = flight.duration === 0 ? 1 : Math.min(1, age / flight.duration);
      positionProjectile(flight, progress);
      if (progress >= 1) arriveProjectile(flight);
    }
  }

  function flashItem(index) {
    const node = document.querySelector(`#table-loadout [data-slot="${index}"]`);
    const inventory = document.querySelector(`#slots [data-slot="${index}"]`);
    pulseItem(inventory, 'cooldown-flash', .55);
    pulseItem(node, 'is-triggering', .55);
  }

  function boostNeighbor(index) {
    const neighbor = document.querySelector(`#table-loadout [data-slot="${index}"]`);
    const inventory = document.querySelector(`#slots [data-slot="${index}"]`);
    pulseItem(neighbor, 'is-boosted', .6);
    pulseItem(inventory, 'cooldown-flash', .6);
  }

  function gabrielCoordinates() {
    const stage = stageDimensions();
    return { x: Math.max(stage.width * .07, window.innerWidth <= 760 ? 39 : 49), y: stage.height * .51 };
  }

  function animateItemActivation(event, shieldGain, guardAmount, positions, killedTargets) {
    const visual = ITEM_VISUALS[event.itemId];
    const flights = { targets: new Map(), support: null };
    if (!visual) return flights;
    flashItem(event.slot);
    const from = sourceCoordinates(event.slot);
    playSound('launch', { itemId: event.itemId, effect: event.effect, level: event.level, pan: soundPan(from) });
    const burst = createCombatEffect('item-burst', { x: from.x, y: from.y - 30 }, visual.color);
    if (burst) {
      burst.dataset.effect = event.effect;
      burst.dataset.effectRole = 'source';
      burst.dataset.slot = String(event.slot);
      const symbol = document.createElement('span'); symbol.className = 'burst-symbol';
      const definition = itemDefinition(event.itemId, event.level);
      if (definition.iconPath) symbol.innerHTML = itemIcon(definition);
      else symbol.textContent = visual.symbol;
      const label = document.createElement('span'); label.className = 'burst-label';
      label.textContent = guardAmount !== undefined ? `${guardAmount} Block bereit` : shieldGain !== undefined ? shieldGain > 0 ? `+${shieldGain} Schild` : 'Schild bereit!' : event.effect === 'haste' ? event.rechargedSlots?.length ? visual.label : 'Keine Aufladung nötig' : event.itemId === 'podcast' ? event.finale ? 'Noch ein letzter Gedanke!' : `Gedanke ${event.episode}/3` : event.itemId === 'batomon' ? event.targets.some(target => ['erbsen', 'brokkoli'].includes(target.type)) ? 'Sehr effektiv!' : 'Showdown!' : visual.label;
      burst.append(symbol); burst.append(label);
    }
    for (const target of event.targets.slice(0, 8)) {
      const reverse = event.effect === 'store';
      const effective = event.effect === 'type_attack' && ['erbsen', 'brokkoli'].includes(target.type);
      const icon = reverse ? ENEMIES[target.type].icon : event.itemId === 'batomon' && !effective ? '🐉' : event.itemId === 'awp' ? '•' : visual.symbol;
      const snapshot = { ...positions.get(target.uid), ...target, destroyed: killedTargets.has(target.uid) };
      flights.targets.set(target.uid, launchProjectile(event.itemId, event.slot, snapshot, icon, visual.color, event.effect, { effective, level: event.level }));
    }
    if (['push', 'slow', 'pulse'].includes(event.effect)) {
      const wave = createCombatEffect(event.effect === 'push' ? 'heat-wave' : 'voice-wave', { x: from.x + 12, y: from.y - 12 }, visual.color);
      if (wave) wave.dataset.effect = event.effect;
    }
    if (['shield', 'coffee', 'refresh', 'radio'].includes(event.effect)) {
      flights.support = launchProjectile(event.itemId, event.slot, null, visual.symbol, visual.color, event.effect, { level: event.level });
    }
    if (event.effect === 'mouth_guard') {
      const guard = createCombatEffect('guard-aura', gabrielCoordinates(), visual.color);
      if (guard) guard.dataset.state = 'ready';
    }
    if (event.effect === 'refresh') createCombatEffect('beer-bubbles', { x: from.x, y: from.y - 18 }, visual.color);
    if (event.effect === 'assist') createCombatEffect('assist-wave', { x: from.x, y: from.y - 12 }, visual.color);
    if (event.effect === 'podcast') createCombatEffect('debate-wave', { x: from.x, y: from.y - 12 }, visual.color, 800);
    if (['radio', 'haste'].includes(event.effect)) createCombatEffect(event.effect === 'haste' ? 'haste-wave' : 'radio-wave', { x: from.x, y: from.y - 12 }, visual.color, 650);

    const supportKind = { refresh: 'beer', assist: 'luca', radio: 'radio', haste: 'haste' }[event.effect];
    if (supportKind) for (const index of event.rechargedSlots || []) {
      const style = SUPPORT_VISUALS[supportKind];
      connectItems(event.slot, index, { className: `support-link${supportKind === 'radio' ? ' radio-link' : supportKind === 'haste' ? ' haste-link' : ''}`,
        impactClass: `support-impact${supportKind === 'haste' ? ' haste-impact' : ''}`, kind: supportKind, ...style, duration: .45 });
    }

    for (const index of event.rechargedSlots || []) boostNeighbor(index);
    if (event.effect === 'coffee') {
      createCombatEffect('coffee-steam', { x: from.x, y: from.y - 25 }, visual.color);
      for (const synergy of Core.getSynergies(run).filter(value => value.coffee && value.source === event.slot)) {
        for (const index of synergy.slots.filter(index => index !== event.slot)) {
          connectItems(event.slot, index, { className: 'support-link', impactClass: 'support-impact', kind: 'coffee', ...SUPPORT_VISUALS.coffee, duration: .45 });
          boostNeighbor(index);
        }
      }
    }
    animatePassiveSynergies(event.slot);
    return flights;
  }

  function animateChain(event) {
    const audioSource = event.id === 'gaming_rhythm' && Number.isInteger(event.activatedSlot) ? event.activatedSlot : event.sourceSlot;
    playSound('chain', { chainId: event.id, itemId: run.slots[audioSource]?.id, pan: Number.isInteger(audioSource) ? soundPan(sourceCoordinates(audioSource)) : 0 });
    const feed = $('chain-feed');
    while (feed.children.length >= 3) feed.children[0].remove();
    const notice = document.createElement('div');
    notice.className = 'chain-notice';
    notice.dataset.chain = event.id;
    const targets = (event.rechargedSlots || []).map(index => itemDefinition(run.slots[index])?.name).filter(Boolean).join(', ');
    const detail = event.id === 'beer_focus' ? `${targets}: nächster normaler Angriff +20 %.` : ['marked_finish', 'snus_beer'].includes(event.id) ? `${targets}: insgesamt ${format(event.amount || 0)} s früher bereit.` : event.message || '';
    notice.innerHTML = `<strong>${escapeHTML(event.name)}</strong><span>${escapeHTML(detail)}</span>`;
    feed.append(notice);
    transientEffects.add({ node: notice, expires: effectTime + 5.5 });
    if (Number.isInteger(event.slot)) {
      boostNeighbor(event.slot);
      const from = sourceCoordinates(event.slot);
      const burst = createCombatEffect('chain-burst', { x: from.x, y: from.y - 44 }, ITEM_VISUALS[run.slots[event.slot]?.id]?.color || '#263e35', 1400);
      if (burst) { burst.textContent = event.name; burst.dataset.chain = event.id; }
    }
    const style = CHAIN_VISUALS[event.id] || { color: '#8a9e6d', symbol: '✦' };
    const source = event.id === 'gaming_rhythm' && Number.isInteger(event.activatedSlot) ? event.activatedSlot : event.sourceSlot;
    const recipients = [...new Set(event.rechargedSlots?.length ? event.rechargedSlots : [event.slot])];
    for (const target of recipients) connectItems(Number.isInteger(source) ? source : target, target,
      { className: 'chain-link', impactClass: 'chain-impact', chain: event.id, role: 'chain-link', ...style, duration: .6, drain: true });
    for (const index of event.rechargedSlots || []) boostNeighbor(index);
  }

  function handleEvents(events, positions) {
    let latestMessage = '';
    let flights = { targets: new Map(), support: null };
    const shieldGains = new Map(events.filter(event => event.type === 'shield').map(event => [event.slot, event.amount]));
    const guardAmounts = new Map(events.filter(event => event.type === 'guard').map(event => [event.slot, event.amount]));
    const killedTargets = new Set(events.filter(event => event.type === 'kill').map(event => event.enemyUid));
    for (const uid of killedTargets) {
      const visual = enemyVisuals.get(uid);
      if (visual) { visual.destroyed = true; visual.enemy.hp = 0; }
    }
    for (const event of events) {
      const enemy = event.position || positions.get(event.enemyUid) || run.battle?.enemies.find(value => value.uid === event.enemyUid);
      if (event.type === 'activate') flights = animateItemActivation(event, shieldGains.get(event.slot), guardAmounts.get(event.slot), positions, killedTargets);
      if (event.type === 'chain') {
        const killFlight = event.id === 'marked_finish' ? [...flights.targets.values()].find(flight => flight.slot === event.sourceSlot) : null;
        if (killFlight) killFlight.feedback.push(event);
        else animateChain(event);
      }
      if (event.type === 'enemy_heal' && enemy) {
        playSound('heal', { enemy: true, pan: soundPan(targetCoordinates({ ...enemy, uid: event.enemyUid })) });
        addEffect(`+${format(event.amount)} ♥`, enemy.x, enemy.lane, 'shield');
        const node = enemyNodes.get(event.enemyUid);
        if (node) node.dataset.healUntil = String(visualTime + .65);
      }
      if (event.type === 'enemy_heal_blocked' && enemy) {
        const point = targetCoordinates({ ...enemy, uid: event.enemyUid });
        pointFeedback('Nachschlag blockiert', point, 'paint-block');
        const splash = createCombatEffect('paint-splash', point, ITEM_VISUALS.umut.color, 650);
        if (splash) splash.dataset.enemyUid = event.enemyUid;
        playSound('block', { itemId: 'umut', effect: 'paint', pan: soundPan(point) });
      }
      if (event.type === 'attack' || event.type === 'kill') {
        const flight = flights.targets.get(event.enemyUid);
        if (flight) flight.feedback.push(event);
        else if (enemy) {
          pointFeedback(event.type === 'kill' ? '✳' : `−${event.amount}`, targetCoordinates({ ...enemy, uid: event.enemyUid }));
          if (event.type === 'attack') playSound('impact', { itemId: run.slots[event.slot]?.id, effect: ITEMS[run.slots[event.slot]?.id]?.effect, pan: soundPan(targetCoordinates({ ...enemy, uid: event.enemyUid })) });
        }
      }
      if (event.type === 'shield' && event.amount > 0) {
        if (flights.support) flights.support.feedback.push(event);
        else { pointFeedback(`+${event.amount} ◇`, gabrielCoordinates(), 'shield'); playSound('shield', { itemId: run.slots[event.slot]?.id, pan: soundPan(gabrielCoordinates()) }); }
      }
      if (event.type === 'guard_block') {
        const guard = createCombatEffect('guard-aura', gabrielCoordinates(), ITEM_VISUALS.snus.color);
        if (guard) guard.dataset.state = 'blocked';
        addEffect(`Snus blockt ${event.amount}`, .03, enemy?.lane ?? 1, 'shield');
        playSound('block', { itemId: 'snus', effect: 'mouth_guard', pan: soundPan(gabrielCoordinates()) });
      }
      if (event.type === 'hit') {
        addEffect(event.amount > 0 ? `−${event.amount} ♥` : 'Ausrede!', .03, enemy?.lane ?? 1, 'damage');
        if (event.amount > 0) {
          $('battle-stage').classList.remove('is-hit');
          void $('battle-stage').offsetWidth;
          $('battle-stage').classList.add('is-hit');
          playSound('hurt', { pan: soundPan(gabrielCoordinates()) });
        } else playSound('block', { effect: 'shield', pan: soundPan(gabrielCoordinates()) });
      }
      if (event.type === 'victory' || event.type === 'defeat') pendingResultSound = { cue: event.type, final: run.phase === 'won' };
      if (event.message && event.type !== 'spawn' && event.type !== 'shield') latestMessage = event.message;
    }
    if (latestMessage) $('combat-journal').textContent = latestMessage;
  }

  function recordRunResult() {
    if (!run.resultRecorded) {
      record.best = Math.max(record.best, run.stats.coursesCleared);
      if (run.phase === 'won') record.wins++;
      run.resultRecorded = true;
    }
  }

  function finishRun() {
    recordRunResult();
    save();
    showResult();
  }

  function showResult() {
    const won = run.phase === 'won';
    $('result-icon').textContent = won ? '✳' : '🍴';
    $('result-eyebrow').textContent = won ? 'KÜCHE GESCHLOSSEN · GABEL GEWINNT' : 'DIESMAL GEHT DER PUNKT AN LEONIE';
    $('result-title').textContent = won ? 'Gabel gibt nicht nach.' : 'Gabel greift zu.';
    $('result-description').textContent = won ? 'Sechs Gänge abgewehrt. Das Dessert ist Geschichte. Gabriel kann endlich in Ruhe weiterzocken. Leonie plant schon das Frühstück.' : `Die Willenskraft war aufgebraucht. Leonies ${Core.getBattlePlan(run).formation.name} hat Gabriel überzeugt. Beim nächsten Versuch helfen andere Nachbarn und neue Ausreden.`;
    $('result-stats').innerHTML = `<div class="result-stat"><strong>${run.stats.coursesCleared}/6</strong><span>GÄNGE GESCHAFFT</span></div><div class="result-stat"><strong>${run.stats.killed}</strong><span>GERICHTE ABGEWEHRT</span></div><div class="result-stat"><strong>${Math.ceil(run.willpower)}</strong><span>WILLENSKRAFT ÜBRIG</span></div>`;
    if (!$('result-dialog').open) $('result-dialog').showModal();
  }

  function togglePause() {
    if (!showingBattle()) return;
    paused = !paused;
    renderControls();
    if (paused) { stopSounds(true); save(); }
    else unlockAudio();
  }

  function onServe() {
    if (!run) return;
    if (endingBattle) { if (paused) togglePause(); return; }
    if (run.phase === 'prep') {
      if (Core.getEncounter(run)) { $('event-title').focus({ preventScroll: true }); return; }
      if (run.bench.length > MAX_BENCH_SIZE) { toast(benchOverflowHint()); return; }
      clearCombatEffects();
      selected = null;
      if (!Core.startBattle(run)) return;
      shopMessage = '';
      paused = false;
      unlockAudio();
      $('combat-journal').textContent = `Leonie serviert Gang ${run.course + 1}. Deine Ausreden übernehmen …`;
      save(); render();
      window.scrollTo({ top: 0, behavior: 'instant' });
      $('pause-button').focus({ preventScroll: true });
    } else if (run.phase === 'battle' && paused) togglePause();
    else if (['won', 'lost'].includes(run.phase)) showResult();
  }

  function completeShopAction(message, focusSelector = '#shop-summary', cue = 'ui', soundOptions = {}) {
    clearCombatEffects();
    shopMessage = message;
    selected = null;
    playSound(cue, soundOptions);
    save(); render();
    const target = document.querySelector(focusSelector);
    (target && !target.disabled ? target : $('shop-summary')).focus({ preventScroll: true });
  }

  function onEncounterChoice(choiceId) {
    if (!run || showingBattle() || !Core.getEncounter(run) || !Core.chooseEncounter(run, choiceId)) return;
    const result = run.encounters.history.at(-1);
    shopMessage = result?.message || 'Entscheidung getroffen. Weiter in den Pfandladen.';
    selected = null;
    playSound('ui');
    save(); render();
    window.scrollTo({ top: 0, behavior: 'instant' });
    $('screen-title').focus({ preventScroll: true });
    toast(shopMessage);
  }

  function onBuy(index) {
    if (endingBattle || run?.phase !== 'prep') return;
    const offer = run.shop.offers[index];
    const preview = Core.purchasePreview(run, index);
    if (!offer || !preview || !Core.buyItem(run, index)) return;
    const name = itemDefinition(preview.item).name;
    const message = preview.merges.length ? `${name} zu Stufe ${preview.item.level} verschmolzen. −${offer.price} Pfandmünzen.` : `${name} gekauft${preview.index >= 6 ? ' und auf die Fensterbank gestellt' : ''}. −${offer.price} Pfandmünzen.`;
    completeShopAction(message, '#shop-offers [data-offer]', preview.merges.length ? 'fusion' : 'buy', { itemId: preview.item.id, level: preview.item.level });
    toast(message);
  }

  function onLock(index) {
    if (endingBattle || run?.phase !== 'prep' || !Core.toggleShopLock(run, index)) return;
    completeShopAction(run.shop.offers[index].locked ? 'Angebot reserviert: bleibt bei Rerolls und für den nächsten Gang erhalten.' : 'Reservierung aufgehoben.', `[data-lock="${index}"]`);
  }

  function onReroll() {
    if (endingBattle || run?.phase !== 'prep') return;
    const cost = Core.getRerollCost(run);
    if (!Core.rerollShop(run)) return;
    completeShopAction(`Neue Angebote für ${cost} ${cost === 1 ? 'Münze' : 'Münzen'}. Reservierte Gegenstände bleiben liegen.`, '#reroll-button', 'reroll');
  }

  function onHeal() {
    if (endingBattle || run?.phase !== 'prep') return;
    const before = run.willpower;
    if (!Core.heal(run)) return;
    completeShopAction(`Einmal tief durchatmen: +${format(run.willpower - before)} Willenskraft für 4 Pfandmünzen.`, '#heal-button', 'heal');
  }

  function onSell(index) {
    if (endingBattle || run?.phase !== 'prep') return;
    const item = getItem(index);
    if (!item) return;
    const name = itemDefinition(item).name;
    const value = Core.getSellValue(run, index);
    if (!Core.sellItem(run, index)) return;
    const message = `${name} verkauft. +${value} Pfandmünzen.`;
    completeShopAction(message, '#sell-title', 'sell', { itemId: item.id, level: item.level });
    toast(message);
  }

  function onUpgrade(index) {
    if (endingBattle || run?.phase !== 'prep') return;
    const preview = Core.upgradePreview(run, index);
    if (!preview?.affordable || !Core.upgradeItem(run, index)) return;
    clearCombatEffects();
    selected = preview.index;
    const name = itemDefinition(preview.item).name;
    shopMessage = `${name} auf Stufe ${preview.item.level} aufgewertet${preview.merges.length ? ' und fusioniert' : ''}. −${preview.cost} Pfand.`;
    playSound(preview.merges.length ? 'fusion' : 'upgrade', { itemId: preview.item.id, level: preview.item.level });
    save(); render();
    document.querySelector('#item-detail-name')?.focus({ preventScroll: true });
    toast(shopMessage);
  }

  function onTactic(index, tacticId) {
    if (endingBattle || run?.phase !== 'prep' || !Core.setTactic(run, index, tacticId)) return;
    hideItemTooltip();
    save();
    renderSlots();
    document.querySelector(`[data-tactic-slot="${index}"][data-tactic="${tacticId}"]`)?.focus({ preventScroll: true });
    playSound('ui');
  }

  function itemHelpAnchor(target) {
    if (target.closest('[data-buy], [data-lock], [data-sell], [data-upgrade], [data-tactic], summary, .offer-more')) return null;
    return target.closest('[data-slot], [data-offer]');
  }

  document.addEventListener('click', event => {
    const encounterChoice = event.target.closest('[data-event-choice]');
    if (encounterChoice) onEncounterChoice(encounterChoice.dataset.eventChoice);
    const slot = event.target.closest('[data-slot]');
    if (slot && run) {
      if (showingBattle() && lastPointerType === 'touch' && slot.closest('#table-loadout')) showItemTooltip(slot);
      else selectSlot(Number(slot.dataset.slot), slot.closest('#table-loadout') ? 'table-loadout' : Number(slot.dataset.slot) >= 6 ? 'bench' : 'slots');
    }
    const upgrade = event.target.closest('[data-upgrade]');
    if (upgrade) onUpgrade(Number(upgrade.dataset.upgrade));
    const tactic = event.target.closest('[data-tactic]');
    if (tactic) onTactic(Number(tactic.dataset.tacticSlot), tactic.dataset.tactic);
    const buy = event.target.closest('[data-buy]');
    if (buy) onBuy(Number(buy.dataset.buy));
    const lock = event.target.closest('[data-lock]');
    if (lock) onLock(Number(lock.dataset.lock));
    const sell = event.target.closest('[data-sell]');
    if (sell) onSell(Number(sell.dataset.sell));
    if (event.target.closest('[data-close-dialog]')) event.target.closest('dialog')?.close();
  });
  document.addEventListener('pointerover', event => {
    if (event.pointerType === 'touch') return;
    lastPointerType = event.pointerType || 'mouse';
    const anchor = itemHelpAnchor(event.target);
    if (anchor) showItemTooltip(anchor);
    else if (!$('item-tooltip').contains(event.target)) hideItemTooltip();
  });
  document.addEventListener('pointerdown', event => {
    lastPointerType = event.pointerType || 'mouse';
    if (lastPointerType === 'touch' && !$('item-tooltip').contains(event.target)) hideItemTooltip();
  });
  document.addEventListener('pointerout', event => {
    if (!tooltipAnchor) return;
    if (tooltipAnchor.contains(event.relatedTarget) || $('item-tooltip').contains(event.relatedTarget)) return;
    if (tooltipAnchor.contains(event.target) || $('item-tooltip').contains(event.target)) hideItemTooltip();
  });
  document.addEventListener('focusin', event => {
    if (lastPointerType === 'touch') return;
    const anchor = itemHelpAnchor(event.target);
    if (anchor) showItemTooltip(anchor);
    else hideItemTooltip();
  });
  document.addEventListener('focusout', event => {
    if (tooltipAnchor && !tooltipAnchor.contains(event.relatedTarget)) hideItemTooltip();
  });
  document.addEventListener('scroll', event => { if (!$('item-tooltip').contains(event.target)) hideItemTooltip(); }, true);
  document.addEventListener('dragstart', event => {
    hideItemTooltip();
    const slot = event.target.closest('[data-slot]');
    const index = slot ? Number(slot.dataset.slot) : -1;
    if (!slot || endingBattle || run?.phase !== 'prep' || !getItem(index)) { event.preventDefault(); return; }
    draggedItem = { index, uid: getItem(index).uid };
    event.dataTransfer.setData('text/plain', String(index));
    event.dataTransfer.effectAllowed = 'move';
    renderSellZone();
  });
  document.addEventListener('dragover', event => {
    const zone = event.target.closest('#sell-zone');
    if (zone) {
      if (currentDraggedIndex() === null) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      zone.classList.add('drag-over');
      return;
    }
    const slot = event.target.closest('[data-slot]');
    if (!slot || endingBattle || run?.phase !== 'prep') return;
    event.preventDefault(); event.dataTransfer.dropEffect = 'move'; slot.classList.add('drag-over');
  });
  document.addEventListener('dragleave', event => {
    const zone = event.target.closest('#sell-zone');
    if (zone && !zone.contains(event.relatedTarget)) zone.classList.remove('drag-over');
    event.target.closest('[data-slot]')?.classList.remove('drag-over');
  });
  document.addEventListener('dragend', clearItemDrag);
  document.addEventListener('drop', event => {
    const zone = event.target.closest('#sell-zone');
    if (zone) {
      const index = currentDraggedIndex();
      const valid = index !== null && event.dataTransfer.getData('text/plain') === String(index);
      if (valid) event.preventDefault();
      clearItemDrag();
      if (valid) onSell(index);
      return;
    }
    const slot = event.target.closest('[data-slot]');
    if (!slot || endingBattle || run?.phase !== 'prep') { clearItemDrag(); return; }
    event.preventDefault();
    const raw = event.dataTransfer.getData('text/plain');
    clearItemDrag();
    if (!/^\d+$/.test(raw)) return;
    if (Core.moveItem(run, Number(raw), Number(slot.dataset.slot))) { selected = null; playSound('ui'); save(); renderSlots(); }
  });
  $('new-run-button').addEventListener('click', requestNewRun);
  $('restart-button').addEventListener('click', requestNewRun);
  $('confirm-restart-button').addEventListener('click', startNewRun);
  $('continue-button').addEventListener('click', showGame);
  $('home-button').addEventListener('click', showHome);
  $('result-home-button').addEventListener('click', showHome);
  $('result-report-button').addEventListener('click', () => openReport('result'));
  $('report-toggle').addEventListener('click', () => openReport('round'));
  $('report-dialog').addEventListener('close', () => {
    const origin = reportOrigin;
    reportOrigin = null;
    $('report-toggle').setAttribute('aria-expanded', 'false');
    if (!gameVisible) return;
    if (origin === 'result' && ['won', 'lost'].includes(run?.phase)) {
      showResult();
      $('result-report-button').focus({ preventScroll: true });
    } else if (origin === 'round') $('report-toggle').focus({ preventScroll: true });
  });
  $('play-again-button').addEventListener('click', startNewRun);
  $('serve-button').addEventListener('click', onServe);
  $('shop-serve-button').addEventListener('click', onServe);
  $('reroll-button').addEventListener('click', onReroll);
  $('heal-button').addEventListener('click', onHeal);
  $('pause-button').addEventListener('click', togglePause);
  $('speed-button').addEventListener('click', () => { speed = speed % 3 + 1; renderControls(); });
  $('sound-button').addEventListener('click', () => {
    soundEnabled = !soundEnabled; audioUnavailable = false; audioGeneration++;
    sound?.setEnabled(soundEnabled); pendingResultSound = null;
    renderSound();
    const generation = audioGeneration;
    if (soundEnabled && !(showingBattle() && paused)) unlockAudio().then(ready => {
      if (ready && generation === audioGeneration) playSound('ui');
    });
    else sound?.stop();
    try { localStorage.setItem(SOUND_KEY, String(soundEnabled)); } catch { /* Sound also works without storage. */ }
  });
  $('sound-volume').addEventListener('input', () => {
    const value = Number($('sound-volume').value);
    if (!Number.isFinite(value)) return;
    soundVolume = Math.max(0, Math.min(1, value / 100)); sound?.setVolume(soundVolume); renderSound();
    try { localStorage.setItem(VOLUME_KEY, String(soundVolume)); } catch { /* Preferences are optional. */ }
  });
  $('help-button').addEventListener('click', () => { if (showingBattle() && !paused) togglePause(); else stopSounds(true); $('help-dialog').showModal(); });
  document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('close', () => {
    if (soundEnabled && gameVisible && !paused && !document.hidden && !document.querySelector('dialog[open]')) sound?.resume().catch(() => {});
  }));
  document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', event => { if (event.target === dialog && dialog.id !== 'result-dialog') { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } }));
  document.addEventListener('keydown', event => {
    if (event.key === 'Tab') lastPointerType = 'keyboard';
    if (event.key === 'Escape') { hideItemTooltip(); clearItemDrag(); }
    if (event.code === 'Space' && !event.repeat && gameVisible && showingBattle() && !document.querySelector('dialog[open]') && !['INPUT', 'TEXTAREA', 'SELECT', 'A'].includes(document.activeElement.tagName) && !document.activeElement.isContentEditable) { event.preventDefault(); togglePause(); }
    if (event.key === 'Escape' && selected !== null && !document.querySelector('dialog[open]')) { selected = null; renderSlots(); }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopSounds(true);
    else if (soundEnabled && !paused && !document.querySelector('dialog[open]')) sound?.resume().catch(() => {});
    if (document.hidden && showingBattle()) { paused = true; renderControls(); save(); }
  });
  window.addEventListener('pagehide', () => { save(); stopSounds(true); });
  window.addEventListener('resize', () => { hideItemTooltip(); updateTableLinks(); });

  function frame(now) {
    const elapsed = Math.min(.08, Math.max(0, (now - lastFrame) / 1000));
    lastFrame = now;
    if (gameVisible && showingBattle() && !paused && !document.hidden && !document.querySelector('dialog[open]')) {
      visualTime += elapsed * speed;
      effectTime += elapsed;
      let events = [];
      const positions = new Map((run.battle?.enemies || []).map(enemy => [enemy.uid, { ...enemy }]));
      if (run.phase === 'battle') {
        const battleBefore = run.battle;
        events = Core.updateBattle(run, elapsed * speed);
        if (run.phase !== 'battle') {
          endingBattle = battleBefore;
          record.best = Math.max(record.best, run.stats.coursesCleared);
          if (['won', 'lost'].includes(run.phase)) recordRunResult();
          save();
        }
      }
      // Measure the current rendered icon after movement, then launch or track its shot.
      // Keep vanished targets until this batch's projectiles can retain them.
      renderBattle(false);
      handleEvents(events, positions);
      updateProjectiles();
      updateTableLinks();
      updateItemPulses();
      for (const effect of transientEffects) {
        if (effect.anchorSlot !== undefined) {
          const point = sourceCoordinates(effect.anchorSlot);
          effect.node.style.left = `${point.x}px`; effect.node.style.top = `${point.y}px`;
        }
        if ((effect.combatClock ? visualTime : effectTime) >= effect.expires) {
          effect.node.remove(); transientEffects.delete(effect);
        }
      }
      renderBattle();
      if (now - lastHUD > 90) { renderHUD(); lastHUD = now; }
      if (endingBattle) {
        const fading = [...enemyVisuals.values()].some(visual => visual.pending > 0 || visual.defeatedAt !== null);
        const finishingChain = [...tableLinks, ...transientEffects].some(effect => effect.drain);
        if (projectiles.size === 0 && !fading && !finishingChain) {
          endingBattle = null;
          shopMessage = '';
          const resultSound = pendingResultSound; pendingResultSound = null;
          if (resultSound) playSound(resultSound.cue, { final: resultSound.final });
          render();
          window.scrollTo({ top: 0, behavior: 'instant' });
          if (['won', 'lost'].includes(run.phase)) finishRun();
          else $(Core.getEncounter(run) ? 'event-title' : 'screen-title').focus({ preventScroll: true });
        }
      } else if (now - lastSaved > 1800) save();
    }
    requestAnimationFrame(frame);
  }

  load();
  requestAnimationFrame(frame);
})();
