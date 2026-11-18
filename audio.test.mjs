import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
await import('./dist/audio.js');
const createAudio = globalThis.AbendessenAudio;

class Parameter {
  constructor(value = 0) { this.value = value; this.events = []; }
  setValueAtTime(value, at) { this.value = value; this.events.push({ type: 'set', value, at }); }
  linearRampToValueAtTime(value, at) { this.value = value; this.events.push({ type: 'linear', value, at }); }
  exponentialRampToValueAtTime(value, at) { this.value = value; this.events.push({ type: 'exponential', value, at }); }
  cancelScheduledValues(at) { this.events.push({ type: 'cancel', at }); }
}
class Node {
  constructor(context, kind) { this.context = context; this.kind = kind; this.connections = []; this.disconnected = false; context.nodes.push(this); }
  connect(target) { this.connections.push(target); return target; }
  disconnect() { this.connections = []; this.disconnected = true; }
}
class Source extends Node {
  constructor(context, kind) { super(context, kind); this.frequency = new Parameter(); this.detune = new Parameter(); this.onended = null; this.started = []; this.stopped = []; context.sources.push(this); }
  start(at, offset) { this.started.push({ at, offset }); this.startAt = at; }
  stop(at = this.context.currentTime) { this.stopped.push(at); this.stopAt = at; }
}
class MockContext {
  static instances = [];
  constructor() { this.currentTime = 0; this.state = 'suspended'; this.sampleRate = 1000; this.nodes = []; this.sources = []; this.buffers = []; this.destination = new Node(this, 'destination'); this.constructor.instances.push(this); }
  createGain() { const node = new Node(this, 'gain'); node.gain = new Parameter(); return node; }
  createDynamicsCompressor() { const node = new Node(this, 'compressor'); for (const field of ['threshold', 'knee', 'ratio', 'attack', 'release']) node[field] = new Parameter(); return node; }
  createBiquadFilter() { const node = new Node(this, 'filter'); node.frequency = new Parameter(); node.Q = new Parameter(); return node; }
  createStereoPanner() { const node = new Node(this, 'panner'); node.pan = new Parameter(); return node; }
  createOscillator() { return new Source(this, 'oscillator'); }
  createBufferSource() { return new Source(this, 'noise'); }
  createBuffer(channels, length, sampleRate) { const data = new Float32Array(length); const buffer = { channels, length, sampleRate, getChannelData: () => data }; this.buffers.push(buffer); return buffer; }
  async resume() { this.state = 'running'; }
  async suspend() { this.state = 'suspended'; }
  async close() { this.state = 'closed'; }
  advance(seconds) {
    this.currentTime += seconds;
    for (const source of this.sources) if (!source.ended && source.stopAt <= this.currentTime) { source.ended = true; source.onended?.({ target: source }); }
  }
}
class DeferredContext extends MockContext {
  constructor() { super(); this.requests = []; }
  resume() { return new Promise(resolve => { this.requests.push(() => { this.state = 'running'; resolve(); }); }); }
  finishResume() { assert.ok(this.requests.length); this.requests.shift()(); }
}
class DeferredSuspendContext extends MockContext {
  constructor() { super(); this.suspensions = []; this.resumeCalls = 0; }
  async resume() { this.resumeCalls++; this.state = 'running'; }
  suspend() { return new Promise(resolve => { this.suspensions.push(() => { this.state = 'suspended'; resolve(); }); }); }
  finishSuspend(index = 0) { assert.ok(this.suspensions[index]); this.suspensions.splice(index, 1)[0](); }
}
async function ready(options = {}) {
  const audio = createAudio({ AudioContext: MockContext, random: () => .55, ...options });
  audio.setEnabled(true);
  assert.equal(await audio.unlock(), true);
  return { audio, context: MockContext.instances.at(-1) };
}
function voiceNodes(context) { return context.nodes.filter(node => !['destination', 'compressor'].includes(node.kind)).slice(1); }

test('factory aliases, lazy construction and defaults match the public contract', async () => {
  assert.equal(createAudio.createAudio, createAudio);
  const count = MockContext.instances.length;
  const audio = createAudio({ AudioContext: MockContext });
  assert.deepEqual(audio.getState(), { enabled: false, volume: .45, activeVoices: 0 });
  audio.setEnabled(true); audio.setVolume(.6);
  assert.equal(audio.play('ui'), false);
  assert.equal(await audio.resume(), false);
  assert.equal(MockContext.instances.length, count, 'Only unlock may create a context');
  const a = audio.unlock();
  const b = audio.unlock();
  assert.equal(a, b, 'Concurrent unlock calls share a single request');
  assert.equal(await a, true);
  assert.equal(MockContext.instances.length, count + 1);
  assert.equal(audio.play('ui'), true);
  audio.destroy();
});

test('voices route through optional stereo panning, master gain and compressor', async () => {
  const { audio, context } = await ready();
  assert.equal(audio.play('launch', { itemId: 'beer', pan: 4 }), true);
  const master = context.nodes.find(node => node.kind === 'gain');
  const compressor = context.nodes.find(node => node.kind === 'compressor');
  const panner = context.nodes.find(node => node.kind === 'panner');
  assert.equal(master.connections[0], compressor);
  assert.equal(compressor.connections[0], context.destination);
  assert.equal(panner.connections[0], master);
  assert.equal(panner.pan.value, 1);
  assert.ok(compressor.ratio.value > 1 && compressor.threshold.value < 0);
  assert.equal(context.buffers.length, 1);
  assert.ok(context.sources.some(source => source.buffer === context.buffers[0]));
  context.advance(1);
  assert.equal(audio.play('launch', { itemId: 'umut', pan: -4 }), true);
  assert.equal(context.nodes.filter(node => node.kind === 'panner').at(-1).pan.value, -1);
  assert.equal(context.buffers.length, 1, 'Noise is synthesized once and reused');
  audio.destroy();
});

test('natural endings disconnect all voice nodes and release logical voices', async () => {
  const { audio, context } = await ready();
  audio.play('fusion');
  assert.equal(audio.getState().activeVoices, 1, 'An arpeggio is one voice');
  assert.ok(context.sources.length > 2);
  context.advance(1);
  assert.equal(audio.getState().activeVoices, 0);
  assert.ok(voiceNodes(context).every(node => node.disconnected));
  assert.ok(context.sources.every(source => source.onended === null));
  assert.ok(context.nodes.find(node => node.kind === 'compressor').connections.includes(context.destination), 'The reusable mix remains connected');
  audio.destroy();
});

test('the palette has filtered noise, several oscillator colors and finite fading envelopes', async () => {
  const { audio, context } = await ready();
  for (const itemId of ['serviette', 'ventilator', 'gabel', 'awp', 'headset', 'beer', 'snus', 'luca', 'podcast', 'umut', 'walkie', 'ritalin']) {
    assert.equal(audio.play('launch', { itemId, level: 3 }), true);
    context.advance(1.1);
  }
  assert.ok(context.nodes.some(node => node.kind === 'filter' && node.type === 'lowpass'));
  assert.ok(context.nodes.some(node => node.kind === 'filter' && node.type === 'bandpass'));
  const waves = new Set(context.sources.filter(source => source.kind === 'oscillator').map(source => source.type));
  assert.ok(waves.has('sawtooth') && waves.has('square') && waves.has('triangle'));
  for (const node of context.nodes.filter(node => node.kind === 'gain')) {
    for (const event of node.gain.events) if (event.type !== 'cancel') {
      assert.ok(Number.isFinite(event.at) && Number.isFinite(event.value));
      assert.ok(event.value >= 0 && event.value <= 1, 'Envelope and mix gains cannot explode');
    }
  }
  const envelopes = voiceNodes(context).filter(node => node.kind === 'gain' && node.gain.events.some(event => event.type === 'exponential'));
  assert.ok(envelopes.length > 0);
  assert.ok(envelopes.every(node => node.gain.events.some(event => event.type === 'linear')));
  assert.ok(envelopes.some(node => node.gain.events.some(event => event.type === 'exponential' && event.value < .001)));
  assert.equal(context.buffers.length, 1);
  audio.destroy();
});

test('AoE repetitions coalesce within their family while distinct important cues still play', async () => {
  const { audio, context } = await ready();
  assert.equal(audio.play('impact', { itemId: 'batomon', effective: true }), true);
  for (let n = 0; n < 8; n++) assert.equal(audio.play('impact', { itemId: 'batomon' }), false);
  assert.equal(audio.play('shield'), true);
  assert.equal(audio.play('hurt'), true);
  assert.equal(audio.play('chain', { chainId: 'gaming_rhythm' }), true);
  context.advance(.08);
  assert.equal(audio.play('impact', { itemId: 'batomon' }), true);
  audio.destroy();
});

test('voice limit preserves higher priority feedback and endgame jingles can take over a full mix', async () => {
  const { audio, context } = await ready();
  let accepted = 0;
  for (let i = 0; i < 30; i++) accepted += audio.play('launch', { itemId: `distinct-${i}` }) ? 1 : 0;
  assert.equal(accepted, 12);
  assert.equal(audio.getState().activeVoices, 12);
  const buses = context.nodes.filter(node => node.kind === 'gain' && node.connections[0]?.kind === 'panner');
  assert.ok(buses.reduce((sum, bus) => sum + bus.gain.value, 0) <= .64 + 1e-9, 'Simultaneous transients retain headroom before compression');
  assert.equal(audio.play('chain', { chainId: 'marked_finish' }), true);
  assert.equal(audio.getState().activeVoices, 12);
  const previous = [...context.sources];
  assert.equal(audio.play('victory', { final: true }), true);
  assert.equal(audio.getState().activeVoices, 1);
  assert.ok(previous.every(source => source.stopped.at(-1) === context.currentTime && source.disconnected));
  assert.equal(audio.play('victory', { final: true }), false, 'Repeated result renders cannot double the jingle');
  context.advance(1);
  assert.equal(audio.getState().activeVoices, 0);
  audio.destroy();
});

test('a rolling overall budget leaves reserved capacity for feedback and never suppresses the ending', async () => {
  const { audio, context } = await ready();
  let accepted = 0;
  for (let i = 0; i < 80; i++) { context.advance(.006); accepted += audio.play('launch', { itemId: `shot-${i}` }) ? 1 : 0; }
  assert.ok(accepted > 0 && accepted <= 28);
  assert.equal(audio.play('hurt'), true, 'A busy launch stream cannot consume the important-cue reserve');
  assert.equal(audio.play('event', { eventId: 'anka' }), true);
  assert.equal(audio.play('defeat'), true);
  assert.equal(audio.getState().activeVoices, 1);
  audio.destroy();
});

test('mute cancels every already scheduled note and resume never replays anything', async () => {
  const { audio, context } = await ready();
  assert.equal(audio.play('victory', { final: true }), true);
  const scheduled = [...context.sources];
  assert.ok(scheduled.some(source => source.startAt > context.currentTime + .1));
  audio.setEnabled(false);
  assert.equal(audio.getState().activeVoices, 0);
  assert.ok(scheduled.every(source => source.stopped.at(-1) === context.currentTime && source.disconnected && source.onended === null));
  assert.equal(audio.play('ui'), false);
  audio.setEnabled(true);
  await audio.resume();
  context.advance(2);
  assert.equal(context.sources.length, scheduled.length, 'No queued JavaScript jingle starts after unmute');
  assert.equal(audio.getState().activeVoices, 0);
  assert.equal(audio.play('ui'), true);
  audio.destroy();
});

test('stop and suspend clear tails; suspension blocks playback until an explicit resume', async () => {
  const { audio, context } = await ready();
  audio.play('event', { eventId: 'anka' });
  audio.stop();
  assert.equal(audio.getState().activeVoices, 0);
  assert.equal(audio.play('buy'), true, 'Stop clears sound without changing the preference');
  await audio.suspend();
  assert.equal(context.state, 'suspended');
  assert.equal(audio.getState().activeVoices, 0);
  assert.equal(audio.play('buy'), false);
  const count = context.sources.length;
  assert.equal(await audio.resume(), true);
  assert.equal(context.sources.length, count);
  assert.equal(audio.play('buy'), true);
  audio.destroy();
});

test('late unlock completion cannot undo mute, suspension, stop or destruction', async () => {
  for (const action of ['mute', 'suspend', 'stop', 'destroy']) {
    const audio = createAudio({ AudioContext: DeferredContext, random: () => .5 });
    audio.setEnabled(true);
    const promise = audio.unlock();
    const context = MockContext.instances.at(-1);
    assert.equal(context.sources.length, 0);
    if (action === 'mute') audio.setEnabled(false);
    else if (action === 'suspend') await audio.suspend();
    else audio[action]();
    context.finishResume();
    assert.equal(await promise, false);
    assert.equal(audio.play('victory'), false);
    assert.equal(context.sources.length, 0);
    assert.equal(audio.getState().activeVoices, 0);
    if (action !== 'destroy') {
      audio.setEnabled(true);
      const resumed = audio.resume();
      if (context.requests.length) context.finishResume();
      assert.equal(await resumed, true);
      assert.equal(audio.play('ui'), true);
    }
    audio.destroy();
  }
});

test('volume is clamped, invalid numeric input stays finite, and zero-volume playback schedules nothing', async () => {
  const { audio, context } = await ready();
  audio.setVolume(4); assert.equal(audio.getState().volume, 1);
  const master = context.nodes.find(node => node.kind === 'gain');
  assert.equal(master.gain.value, .8);
  audio.setVolume(Number.NaN); assert.equal(audio.getState().volume, 1);
  audio.setVolume(-2); assert.equal(audio.getState().volume, 0);
  assert.equal(audio.play('impact'), false);
  assert.equal(context.sources.length, 0);
  audio.setVolume(.4);
  assert.equal(audio.play('impact'), true);
  audio.destroy();
});

test('all public cue groups and event characters can be scheduled without assets or timers', async () => {
  const { audio, context } = await ready();
  for (const cue of ['ui', 'buy', 'sell', 'reroll', 'upgrade', 'fusion', 'impact', 'shield', 'block', 'hurt', 'chain', 'victory', 'defeat', 'heal']) {
    assert.equal(audio.play(cue, { final: false, killed: true, effective: true }), true);
    context.advance(1.1);
  }
  for (const eventId of ['anka', 'bluetooth', 'yusuf', 'update', 'walkie']) { assert.equal(audio.play('event', { eventId }), true); context.advance(1.1); }
  assert.equal(audio.play('unknown'), false);
  assert.equal(audio.getState().activeVoices, 0);
  audio.destroy();
});

test('missing or failing Web Audio returns false, and the webkit fallback works', async () => {
  const source = await readFile(new URL('./dist/audio.js', import.meta.url), 'utf8');
  const unsupported = vm.createContext({});
  vm.runInContext(source, unsupported);
  const none = unsupported.AbendessenAudio();
  none.setEnabled(true);
  assert.equal(await none.unlock(), false);
  assert.equal(none.play('ui'), false);
  await none.suspend(); none.stop(); none.destroy();
  class Broken { constructor() { throw new Error('blocked by browser'); } }
  const broken = createAudio({ AudioContext: Broken });
  assert.equal(await broken.unlock(), false);
  assert.doesNotThrow(() => broken.destroy());
  const fallback = vm.createContext({ webkitAudioContext: MockContext });
  vm.runInContext(source, fallback);
  const oldBrowser = fallback.AbendessenAudio();
  oldBrowser.setEnabled(true);
  assert.equal(await oldBrowser.unlock(), true);
  assert.equal(oldBrowser.play('ui'), true);
  oldBrowser.destroy();
});

test('browsers without stereo panning still play and destroy is idempotent', async () => {
  class NoPan extends MockContext { constructor() { super(); this.createStereoPanner = undefined; } }
  const { audio, context } = await ready({ AudioContext: NoPan });
  assert.equal(audio.play('launch', { itemId: 'walkie', pan: -.7 }), true);
  audio.destroy(); audio.destroy();
  assert.equal(context.state, 'closed');
  assert.deepEqual(audio.getState(), { enabled: false, volume: .45, activeVoices: 0 });
  assert.equal(await audio.unlock(), false);
  assert.equal(await audio.resume(), false);
  assert.equal(audio.play('ui'), false);
});


test('resume waits for an earlier deferred suspend even while the context still reports running', async () => {
  const { audio, context } = await ready({ AudioContext: DeferredSuspendContext });
  audio.play('event', { eventId: 'anka' });
  const suspending = audio.suspend();
  assert.equal(context.state, 'running', 'The browser has not applied the queued suspension yet');
  assert.equal(audio.play('ui'), false, 'Local suspension applies immediately');
  assert.equal(audio.getState().activeVoices, 0);
  const resumeCalls = context.resumeCalls;
  const resuming = audio.resume();
  await Promise.resolve();
  assert.equal(context.resumeCalls, resumeCalls, 'Resume must not race ahead of the pending suspension');
  context.finishSuspend();
  await suspending;
  assert.equal(await resuming, true);
  assert.equal(context.state, 'running');
  assert.equal(context.resumeCalls, resumeCalls + 1);
  assert.equal(audio.play('ui'), true);
  audio.destroy();
});

test('a later pause invalidates a resume waiting on multiple outstanding suspensions', async () => {
  const { audio, context } = await ready({ AudioContext: DeferredSuspendContext });
  const first = audio.suspend();
  const resuming = audio.resume();
  const second = audio.suspend();
  context.finishSuspend(1);
  await Promise.resolve();
  context.finishSuspend(0);
  await Promise.all([first, second]);
  assert.equal(await resuming, false);
  assert.equal(context.state, 'suspended');
  assert.equal(audio.play('victory'), false);
  assert.equal(await audio.resume(), true);
  assert.equal(context.state, 'running');
  assert.equal(audio.getState().activeVoices, 0, 'Explicit resumption does not restore cancelled sounds');
  audio.destroy();
});
