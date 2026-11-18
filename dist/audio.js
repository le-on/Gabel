/* Gabel gegen Gänge — small offline Web Audio sound palette. No samples or timers. */
(() => {
  'use strict';

  const FLOOR = .0001;
  const MAX_VOICES = 12;
  const NORMAL_BUDGET = 28;
  const TOTAL_BUDGET = 40;
  const CUES = new Set(['ui', 'buy', 'sell', 'reroll', 'upgrade', 'fusion', 'event', 'launch', 'impact', 'shield', 'block', 'hurt', 'chain', 'victory', 'defeat', 'heal']);
  const PRIORITY = { launch: 1, impact: 2, ui: 2, buy: 3, sell: 3, reroll: 3, shield: 3, block: 3, heal: 3, chain: 4, upgrade: 4, fusion: 4, hurt: 4, event: 4, victory: 5, defeat: 5 };
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  function createAudio(options = {}) {
    const suppliedContext = options.AudioContext;
    const random = typeof options.random === 'function' ? options.random : Math.random;
    let context = null;
    let master = null;
    let compressor = null;
    let noiseBuffer = null;
    let enabled = false;
    let volume = .45;
    let suspended = true;
    let destroyed = false;
    let generation = 0;
    let pendingResume = null;
    let suspendBarrier = null;
    const voices = new Set();
    const families = new Map();
    let recent = [];

    function randomValue() {
      try { const value = Number(random()); return Number.isFinite(value) ? clamp(value, 0, .999999) : .5; } catch { return .5; }
    }

    function param(parameter, value, at) {
      if (!parameter) return;
      if (typeof parameter.setValueAtTime === 'function') parameter.setValueAtTime(value, at);
      else parameter.value = value;
    }

    function applyMaster() {
      if (!context || !master) return;
      const at = context.currentTime;
      const gain = enabled && !suspended && !destroyed ? volume * .8 : 0;
      try {
        master.gain.cancelScheduledValues(at);
        param(master.gain, gain, at);
      } catch { /* A closed or interrupted context is harmless to the game. */ }
    }

    function rebalanceMix() {
      if (!context) return;
      // Keep headroom even before the compressor catches simultaneous transients.
      const gain = .16 * Math.min(1, 4 / Math.max(1, voices.size));
      const at = context.currentTime;
      for (const voice of voices) if (voice.bus) {
        try {
          voice.bus.gain.cancelScheduledValues(at);
          voice.bus.gain.linearRampToValueAtTime(gain, at + .008);
        } catch { /* An interrupted browser context may reject automation. */ }
      }
    }

    function disposeVoice(voice, cancel = false) {
      if (!voice.active) return;
      voice.active = false;
      voices.delete(voice);
      rebalanceMix();
      for (const source of voice.sources) {
        source.onended = null;
        if (cancel) { try { source.stop(context?.currentTime || 0); } catch { /* Already ended. */ } }
      }
      for (const node of voice.nodes) { try { node.disconnect(); } catch { /* Already disconnected. */ } }
      voice.sources.clear();
      voice.nodes.clear();
    }

    function stopVoices() {
      for (const voice of [...voices]) disposeVoice(voice, true);
    }

    function clearLimits() { families.clear(); recent = []; }

    function stop() {
      generation++;
      stopVoices();
      clearLimits();
    }

    function ensureContext() {
      if (context) return true;
      const root = typeof window !== 'undefined' ? window : globalThis;
      const Context = suppliedContext || root.AudioContext || root.webkitAudioContext;
      if (typeof Context !== 'function') return false;
      let candidate;
      try {
        candidate = new Context();
        const gain = candidate.createGain();
        const dynamics = candidate.createDynamicsCompressor();
        for (const [key, value] of Object.entries({ threshold: -20, knee: 22, ratio: 7, attack: .003, release: .13 })) param(dynamics[key], value, candidate.currentTime);
        param(gain.gain, 0, candidate.currentTime);
        gain.connect(dynamics); dynamics.connect(candidate.destination);
        const sampleRate = candidate.sampleRate;
        const buffer = candidate.createBuffer(1, Math.max(1, Math.floor(sampleRate)), sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = (randomValue() * 2 - 1) * .8;
        context = candidate; master = gain; compressor = dynamics; noiseBuffer = buffer;
        return true;
      } catch {
        try { const closing = candidate?.close?.(); closing?.catch?.(() => {}); } catch { /* Unsupported audio. */ }
        return false;
      }
    }

    function requestResume(create) {
      if (destroyed) return Promise.resolve(false);
      if (pendingResume?.generation === generation) return pendingResume.promise;
      if (!context && (!create || !ensureContext())) return Promise.resolve(false);
      const target = context;
      const token = ++generation;
      const promise = (async () => {
        try {
          // state may still be "running" until an earlier suspend request settles.
          // Await every outstanding suspension before deciding whether resume is needed.
          if (suspendBarrier) await suspendBarrier;
          if (destroyed || token !== generation || target !== context) return false;
          if (target.state !== 'running') await target.resume();
          else await Promise.resolve();
          if (destroyed || token !== generation || target !== context || target.state !== 'running') return false;
          suspended = false;
          applyMaster();
          return true;
        } catch {
          if (token === generation) { suspended = true; applyMaster(); }
          return false;
        } finally {
          if (pendingResume?.generation === token) pendingResume = null;
        }
      })();
      pendingResume = { generation: token, promise };
      return promise;
    }

    function unlock() { return requestResume(true); }
    function resume() { return requestResume(false); }

    async function suspend() {
      generation++;
      suspended = true;
      stopVoices(); clearLimits(); applyMaster();
      const target = context;
      let operation;
      try { operation = target && target.state !== 'closed' ? target.suspend() : undefined; } catch { /* Remain locally suspended if the browser rejects. */ }
      const barrier = Promise.all([suspendBarrier, Promise.resolve(operation).catch(() => {})]).then(() => {});
      suspendBarrier = barrier;
      try { await barrier; } finally { if (suspendBarrier === barrier) suspendBarrier = null; }
    }

    function setEnabled(value) {
      if (destroyed) return;
      enabled = Boolean(value);
      if (!enabled) stop();
      applyMaster();
    }

    function setVolume(value) {
      if (destroyed || !Number.isFinite(Number(value))) return;
      volume = clamp(Number(value), 0, 1);
      applyMaster();
    }

    function node(voice, value) { voice.nodes.add(value); return value; }

    function envelope(voice, destination, at, duration, gain, attack = .004) {
      const amp = node(voice, context.createGain());
      const peak = clamp(gain, FLOOR, .9);
      param(amp.gain, FLOOR, at);
      amp.gain.linearRampToValueAtTime(peak, at + Math.min(attack, duration * .3));
      amp.gain.exponentialRampToValueAtTime(FLOOR, at + duration);
      amp.gain.linearRampToValueAtTime(0, at + duration + .004);
      amp.connect(destination);
      return amp;
    }

    function scheduleSource(voice, source, at, duration, offset) {
      node(voice, source);
      voice.sources.add(source);
      source.onended = () => {
        if (!voice.active) return;
        voice.sources.delete(source);
        source.onended = null;
        try { source.disconnect(); } catch { /* Already disconnected. */ }
        if (voice.sources.size === 0) disposeVoice(voice);
      };
      if (offset === undefined) source.start(at);
      else source.start(at, offset);
      source.stop(at + duration + .008);
    }

    function tone(voice, frequency, duration, gain, { delay = 0, end = frequency, wave = 'triangle', attack = .003, detune = 0 } = {}) {
      const at = voice.at + delay;
      const oscillator = context.createOscillator();
      oscillator.type = wave;
      param(oscillator.frequency, clamp(frequency, 25, 15000), at);
      if (end !== frequency) oscillator.frequency.exponentialRampToValueAtTime(clamp(end, 25, 15000), at + duration);
      if (oscillator.detune) param(oscillator.detune, detune, at);
      const amp = envelope(voice, voice.bus, at, duration, gain, attack);
      oscillator.connect(amp);
      scheduleSource(voice, oscillator, at, duration);
    }

    function noise(voice, duration, gain, { delay = 0, from = 1400, to = from, filter = 'bandpass', q = .7, attack = .008 } = {}) {
      const at = voice.at + delay;
      const source = context.createBufferSource();
      source.buffer = noiseBuffer; source.loop = true;
      const band = node(voice, context.createBiquadFilter());
      band.type = filter;
      param(band.frequency, clamp(from, 60, 15000), at);
      if (from !== to) band.frequency.exponentialRampToValueAtTime(clamp(to, 60, 15000), at + duration);
      param(band.Q, clamp(q, .1, 4), at);
      const amp = envelope(voice, voice.bus, at, duration, gain, attack);
      source.connect(band); band.connect(amp);
      scheduleSource(voice, source, at, duration, randomValue() * .8);
    }

    function notes(voice, frequencies, spacing = .055, duration = .13, gain = .32, wave = 'triangle') {
      frequencies.forEach((frequency, index) => tone(voice, frequency, duration, gain, { delay: spacing * index, wave }));
    }

    function metal(voice, base = 420, gain = .55, duration = .13) {
      tone(voice, base, duration, gain, { end: base * .94 });
      tone(voice, base * 2.73, duration * .7, gain * .33, { wave: 'sine' });
      tone(voice, base * 4.17, duration * .4, gain * .16, { wave: 'sine' });
      noise(voice, .022, .23, { from: 6500, to: 2800, filter: 'highpass', attack: .001 });
    }

    function radio(voice, gentle = false) {
      noise(voice, .105, gentle ? .35 : .55, { from: 2300, to: 1100, q: 2, attack: .002 });
      tone(voice, 760, .05, .3, { delay: .065, wave: 'square' });
      noise(voice, .02, .15, { delay: .12, from: 3400, filter: 'highpass', attack: .001 });
    }

    function launch(voice, meta) {
      switch (meta.itemId) {
        case 'serviette': noise(voice, .145, .7, { from: 2600, to: 650 }); noise(voice, .055, .2, { from: 5800, filter: 'highpass' }); break;
        case 'ventilator': noise(voice, .24, .75, { from: 500, to: 1900, filter: 'lowpass', attack: .025 }); tone(voice, 75, .16, .18, { end: 105, wave: 'triangle', attack: .018 }); break;
        case 'gabel': metal(voice, 510, .48, .15); break;
        case 'desolator': metal(voice, 310, .55, .16); tone(voice, 140, .1, .16, { wave: 'sawtooth', end: 95 }); break;
        case 'awp': noise(voice, .075, .85, { from: 1900, to: 350, attack: .001 }); tone(voice, 100, .085, .6, { wave: 'sawtooth', end: 42, attack: .002 }); tone(voice, 1750, .035, .14, { delay: .045 }); break;
        case 'paper': metal(voice, 720, .3, .15); break;
        case 'brotdose': noise(voice, .09, .55, { from: 1100, to: 450 }); tone(voice, 185, .095, .45, { end: 115 }); break;
        case 'headset': notes(voice, [520, 780], .045, .075, .24, 'square'); noise(voice, .06, .16, { from: 1600 }); break;
        case 'discord': notes(voice, [392, 587], .05, .12, .4); break;
        case 'kaffee': tone(voice, 840, .115, .3, { wave: 'sine' }); noise(voice, .095, .35, { from: 750, to: 380, filter: 'lowpass', delay: .02 }); break;
        case 'beer': noise(voice, .025, .75, { from: 4500, filter: 'highpass', attack: .001 }); tone(voice, 180, .1, .6, { end: 65, wave: 'sine' }); noise(voice, .15, .35, { from: 400, to: 750, filter: 'lowpass', delay: .03 }); break;
        case 'snus': noise(voice, .035, .5, { from: 1000, to: 420, filter: 'lowpass', attack: .001 }); tone(voice, 240, .055, .3, { end: 170 }); break;
        case 'luca': notes(voice, [440, 660], .055, .1, .32); break;
        case 'batomon': tone(voice, 440, .095, .38, { end: 880, wave: 'square' }); tone(voice, 220, .07, .19, { end: 330 }); break;
        case 'podcast': tone(voice, 330, .115, .3, { end: 280 }); noise(voice, .13, .28, { from: 750, to: 450, filter: 'lowpass' }); tone(voice, 392, .075, .24, { delay: .085 }); break;
        case 'umut': noise(voice, .18, .8, { from: 450, to: 1900, q: .5, attack: .015 }); tone(voice, 220, .08, .22, { end: 110, wave: 'sine' }); break;
        case 'walkie': radio(voice); break;
        case 'ritalin': notes(voice, [600, 800, 1000], .033, .065, .25); break;
        default: noise(voice, .09, .4, { from: 1800, to: 600 }); tone(voice, 330, .06, .25);
      }
    }

    function recipe(voice, cue, meta) {
      switch (cue) {
        case 'launch': launch(voice, meta); break;
        case 'impact':
          if (['gabel', 'desolator', 'awp'].includes(meta.itemId)) metal(voice, meta.itemId === 'awp' ? 235 : 640, .48, .095);
          else if (meta.itemId === 'serviette' || meta.effect === 'store') { noise(voice, .065, .55, { from: 1700, to: 500 }); tone(voice, 190, .05, .26, { end: 125 }); }
          else if (meta.itemId === 'umut' || meta.effect === 'paint') noise(voice, .1, .65, { from: 700, to: 1800, q: .5 });
          else { noise(voice, .035, .4, { from: 1500, to: 500 }); tone(voice, 330, .065, .28, { end: 220 }); }
          if (meta.effective) notes(voice, [740, 988], .025, .07, .22);
          else if (meta.killed) tone(voice, 880, .075, .2, { delay: .025, wave: 'sine' });
          break;
        case 'ui': tone(voice, 740, .045, .24, { end: 620 }); noise(voice, .015, .1, { from: 5000, filter: 'highpass', attack: .001 }); break;
        case 'buy': notes(voice, [660, 990], .045, .11, .34); metal(voice, 1320, .12, .055); break;
        case 'sell': notes(voice, [740, 440], .045, .09, .3); break;
        case 'reroll': noise(voice, .12, .48, { from: 450, to: 2400 }); notes(voice, [430, 580, 760], .035, .05, .22); break;
        case 'upgrade': notes(voice, [440, 554, 659, 880], .055, .14, .32); tone(voice, 220, .2, .18, { wave: 'sine' }); break;
        case 'fusion': notes(voice, [392, 523, 659, 1047], .065, .18, .34); noise(voice, .2, .17, { from: 1800, to: 7000, filter: 'highpass', attack: .018 }); break;
        case 'shield': notes(voice, [660, 990], .025, .19, .33, 'sine'); tone(voice, 1320, .09, .1); break;
        case 'block':
          if (meta.effect === 'paint') noise(voice, .115, .65, { from: 600, to: 1500, q: .5 });
          else if (meta.effect === 'shield') metal(voice, 780, .3, .17);
          else { noise(voice, .065, .6, { from: 900, to: 350, filter: 'lowpass', attack: .002 }); tone(voice, 200, .085, .32, { end: 130 }); }
          break;
        case 'hurt': tone(voice, 165, .145, .55, { end: 65, wave: 'sawtooth', attack: .008 }); noise(voice, .09, .45, { from: 800, to: 160, filter: 'lowpass' }); break;
        case 'heal':
          if (meta.enemy) { notes(voice, [370, 277], .055, .12, .2, 'sine'); noise(voice, .1, .12, { from: 700, filter: 'lowpass' }); }
          else notes(voice, [523, 659, 784], .05, .15, .3, 'sine');
          break;
        case 'chain': {
          const pitches = meta.chainId === 'marked_finish' ? [660, 880, 1320] : meta.chainId === 'snus_beer' ? [330, 440, 660] : meta.chainId === 'podcast_finale' ? [392, 494, 587, 784] : [523, 659, 784];
          notes(voice, pitches, .043, .13, .32);
          break;
        }
        case 'event':
          if (meta.eventId === 'anka') notes(voice, [660, 880, 660], .13, .105, .3);
          else if (meta.eventId === 'bluetooth') { notes(voice, [1108, 1661, 1319], .065, .1, .25, 'sine'); noise(voice, .025, .18, { from: 4000, filter: 'highpass' }); }
          else if (meta.eventId === 'yusuf') { tone(voice, 180, .1, .34, { end: 245, wave: 'sawtooth' }); notes(voice, [480, 640], .08, .065, .2, 'square'); noise(voice, .07, .15, { from: 1100, q: 2 }); }
          else if (meta.eventId === 'update') notes(voice, [740, 554, 880], .095, .075, .25, 'square');
          else if (meta.eventId === 'walkie') radio(voice, true);
          else notes(voice, [440, 554], .07, .13, .3);
          break;
        case 'victory':
          if (meta.final === false) notes(voice, [392, 523, 659], .065, .15, .33);
          else { notes(voice, [392, 494, 587, 784], .1, .23, .35); tone(voice, 196, .38, .2, { wave: 'sine' }); tone(voice, 988, .23, .18, { delay: .3, wave: 'sine' }); }
          break;
        case 'defeat': notes(voice, [392, 370, 294, 196], .105, .19, .36); noise(voice, .18, .2, { delay: .26, from: 700, to: 160, filter: 'lowpass' }); break;
      }
    }

    function familyFor(cue, meta) {
      const suffix = cue === 'launch' || cue === 'impact' ? meta.itemId || meta.effect || 'generic' : cue === 'chain' ? meta.chainId || 'generic' : cue === 'event' ? meta.eventId || 'generic' : '';
      return `${cue}:${suffix}`;
    }

    function play(cue, metadata = {}) {
      if (destroyed || !enabled || volume <= 0 || suspended || !context || context.state !== 'running' || !CUES.has(cue)) return false;
      const meta = metadata && typeof metadata === 'object' ? metadata : {};
      const now = context.currentTime;
      const priority = PRIORITY[cue];
      const endgame = cue === 'victory' || cue === 'defeat';
      const family = familyFor(cue, meta);
      const interval = cue === 'launch' ? .055 : cue === 'impact' ? .065 : cue === 'chain' ? .18 : cue === 'event' ? .5 : endgame ? .9 : ['hurt', 'heal'].includes(cue) ? .12 : .04;
      const previous = families.get(family);
      if (previous !== undefined && now - previous < interval) return false;
      recent = recent.filter(entry => now - entry < 1);
      if (!endgame && (recent.length >= TOTAL_BUDGET || (priority < 3 && recent.length >= NORMAL_BUDGET))) return false;
      if (endgame) stopVoices();
      if (voices.size >= MAX_VOICES) {
        const victim = [...voices].sort((a, b) => a.priority - b.priority || a.at - b.at)[0];
        if (priority <= victim.priority && priority < 3) return false;
        if (priority < victim.priority) return false;
        disposeVoice(victim, true);
      }
      const voice = { active: true, priority, at: now + .002, sources: new Set(), nodes: new Set(), bus: null };
      voices.add(voice);
      try {
        const bus = node(voice, context.createGain());
        param(bus.gain, .16, now);
        voice.bus = bus;
        rebalanceMix();
        if (typeof context.createStereoPanner === 'function') {
          const panner = node(voice, context.createStereoPanner());
          const pan = Number.isFinite(Number(meta.pan)) ? clamp(Number(meta.pan), -1, 1) : 0;
          param(panner.pan, pan, now); bus.connect(panner); panner.connect(master);
        } else bus.connect(master);
        recipe(voice, cue, meta);
        if (!voice.sources.size) { disposeVoice(voice); return false; }
        families.set(family, now); recent.push(now);
        return true;
      } catch {
        disposeVoice(voice, true);
        return false;
      }
    }

    function getState() { return { enabled, volume, activeVoices: voices.size }; }

    function destroy() {
      if (destroyed) return;
      destroyed = true; enabled = false; suspended = true;
      stop(); applyMaster();
      try { master?.disconnect(); compressor?.disconnect(); } catch { /* Already closed. */ }
      const target = context;
      context = null; master = null; compressor = null; noiseBuffer = null;
      try { const closing = target?.close?.(); closing?.catch?.(() => {}); } catch { /* No audio support. */ }
    }

    return { unlock, setEnabled, setVolume, play, suspend, resume, stop, getState, destroy };
  }

  createAudio.createAudio = createAudio;
  globalThis.AbendessenAudio = createAudio;
})();
