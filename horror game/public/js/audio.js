// Fully procedural audio: ambience drones, spatial footsteps (HRTF), the CEO's breathing
// and steps, heartbeat, chase music, stingers and UI/world sounds. No audio files needed.
export class Audio {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.volume = 0.8;
    this.chase = 0; this.chaseTarget = 0;
    this.danger = 0;
    this.heartT = 0;
    this.ambientT = 8;
    this.theme = 'office';
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp); comp.connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.connect(this.master);
    this.music = ctx.createGain(); this.music.gain.value = 0.55; this.music.connect(this.master);
    this.amb = ctx.createGain(); this.amb.gain.value = 0.5; this.amb.connect(this.master);
    // reverb send for that empty-building feel
    this.verb = ctx.createConvolver(); this.verb.buffer = this.impulse(2.6, 2.2);
    this.verbGain = ctx.createGain(); this.verbGain.gain.value = 0.35;
    this.verb.connect(this.verbGain); this.verbGain.connect(this.master);
    this.noiseBuf = this.makeNoise(2, 'white');
    this.brownBuf = this.makeNoise(4, 'brown');
    this.startDrones();
    this.startChaseMusic();
    this.startCeoVoice();
    this.ready = true;
  }

  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }

  makeNoise(sec, kind) {
    const ctx = this.ctx;
    const b = ctx.createBuffer(1, ctx.sampleRate * sec, ctx.sampleRate);
    const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return b;
  }

  impulse(sec, decay) {
    const ctx = this.ctx;
    const len = ctx.sampleRate * sec;
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); }
    return b;
  }

  // ------------------------------------------------------------ building blocks
  panner(at) {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF'; p.distanceModel = 'inverse';
    p.refDistance = 1.5; p.maxDistance = 60; p.rolloffFactor = 1.3;
    p.positionX.value = at[0]; p.positionY.value = at[1] ?? 1; p.positionZ.value = at[2] ?? at[1];
    if (at.length === 2) { p.positionY.value = 1; p.positionZ.value = at[1]; }
    return p;
  }

  out(node, at, verb = 0.3, bus = this.sfx) {
    let last = node;
    if (at) { const p = this.panner(at); node.connect(p); last = p; }
    last.connect(bus);
    if (verb > 0) { const s = this.ctx.createGain(); s.gain.value = verb; last.connect(s); s.connect(this.verb); }
  }

  noise({ dur = 0.2, type = 'lowpass', freq = 1000, q = 1, gain = 0.5, attack = 0.005, at = null, verb = 0.3, freqEnd = null, delay = 0, brown = false }) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const src = ctx.createBufferSource(); src.buffer = brown ? this.brownBuf : this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g);
    this.out(g, at, verb);
    src.start(t, Math.random()); src.stop(t + dur + 0.05);
  }

  tone({ dur = 0.2, type = 'sine', freq = 440, freqEnd = null, gain = 0.3, attack = 0.005, at = null, verb = 0.2, delay = 0, bus }) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    this.out(g, at, verb, bus || this.sfx);
    o.start(t); o.stop(t + dur + 0.05);
  }

  // ------------------------------------------------------------ continuous layers
  startDrones() {
    const ctx = this.ctx;
    this.drone = [];
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220; lp.Q.value = 3;
    const dg = ctx.createGain(); dg.gain.value = 0.0;
    lp.connect(dg); dg.connect(this.amb);
    for (const f of [41, 41.6, 61.7]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = 0.18; o.connect(g); g.connect(lp); o.start();
      this.drone.push(o);
    }
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lg = ctx.createGain(); lg.gain.value = 120; lfo.connect(lg); lg.connect(lp.frequency); lfo.start();
    this.droneGain = dg; this.droneFilter = lp;
    // room tone / air handling
    const air = ctx.createBufferSource(); air.buffer = this.brownBuf; air.loop = true;
    const af = ctx.createBiquadFilter(); af.type = 'lowpass'; af.frequency.value = 400;
    const ag = ctx.createGain(); ag.gain.value = 0.12;
    air.connect(af); af.connect(ag); ag.connect(this.amb); air.start();
    this.airGain = ag; this.airFilter = af;
    // fluorescent buzz (volume driven by nearby lights)
    const bz = ctx.createOscillator(); bz.type = 'sawtooth'; bz.frequency.value = 120;
    const bf = ctx.createBiquadFilter(); bf.type = 'bandpass'; bf.frequency.value = 2400; bf.Q.value = 2;
    const bg = ctx.createGain(); bg.gain.value = 0;
    bz.connect(bf); bf.connect(bg); bg.connect(this.amb); bz.start();
    this.buzzGain = bg;
    // dread pad (music bus) — minor cluster
    const pad = ctx.createGain(); pad.gain.value = 0; pad.connect(this.music);
    const pf = ctx.createBiquadFilter(); pf.type = 'lowpass'; pf.frequency.value = 700; pf.connect(pad);
    for (const f of [110, 130.8, 155.6, 164.8]) {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f; o.detune.value = (Math.random() - 0.5) * 18;
      const g = ctx.createGain(); g.gain.value = 0.06; o.connect(g); g.connect(pf); o.start();
    }
    this.padGain = pad;
  }

  startChaseMusic() {
    const ctx = this.ctx;
    const g = ctx.createGain(); g.gain.value = 0; g.connect(this.music);
    this.chaseGain = g;
    // tremolo strings
    const sf = ctx.createBiquadFilter(); sf.type = 'bandpass'; sf.frequency.value = 1400; sf.Q.value = 0.8;
    const sg = ctx.createGain(); sg.gain.value = 0.0; sf.connect(sg); sg.connect(g);
    for (const f of [880, 932, 987, 1318]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; const og = ctx.createGain(); og.gain.value = 0.05; o.connect(og); og.connect(sf); o.start(); }
    const trem = ctx.createOscillator(); trem.frequency.value = 11; const tg = ctx.createGain(); tg.gain.value = 0.5;
    trem.connect(tg); tg.connect(sg.gain); trem.start();
    sg.gain.value = 0.5;
    this.nextPulse = 0;
  }

  startCeoVoice() {
    const ctx = this.ctx;
    // breathing: bandpassed noise with slow amplitude cycle, spatialised at the CEO
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 500; f.Q.value = 1.5;
    const g = ctx.createGain(); g.gain.value = 0;
    const p = this.panner([0, 2, 0]); p.refDistance = 2; p.rolloffFactor = 1.6;
    // a low growl under the breath
    const growl = ctx.createOscillator(); growl.type = 'sawtooth'; growl.frequency.value = 52;
    const gf = ctx.createBiquadFilter(); gf.type = 'lowpass'; gf.frequency.value = 180;
    const gg = ctx.createGain(); gg.gain.value = 0;
    growl.connect(gf); gf.connect(gg); gg.connect(p);
    src.connect(f); f.connect(g); g.connect(p); p.connect(this.sfx);
    const vs = ctx.createGain(); vs.gain.value = 0.4; p.connect(vs); vs.connect(this.verb);
    src.start(); growl.start();
    this.ceoPanner = p; this.ceoBreath = g; this.ceoGrowl = gg; this.ceoBreathFilter = f;
    this.breathT = 0;
  }

  setTheme(theme) {
    this.theme = theme;
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const cfg = {
      office: { drone: 0.0, air: 0.08, pad: 0.0, filt: 500 },
      archives: { drone: 0.25, air: 0.12, pad: 0.25, filt: 300 },
      lab: { drone: 0.25, air: 0.16, pad: 0.25, filt: 450 },
      containment: { drone: 0.4, air: 0.18, pad: 0.4, filt: 250 },
      bio: { drone: 0.4, air: 0.2, pad: 0.45, filt: 350 },
      executive: { drone: 0.5, air: 0.14, pad: 0.55, filt: 300 },
    }[theme] || {};
    this.droneGain.gain.setTargetAtTime(cfg.drone, t, 2);
    this.airGain.gain.setTargetAtTime(cfg.air, t, 2);
    this.padGain.gain.setTargetAtTime(cfg.pad * 0.6, t, 3);
    this.airFilter.frequency.setTargetAtTime(cfg.filt, t, 1);
    this.themeCfg = cfg;
  }

  setAfterHours(on) {
    if (!this.ready || !on) return;
    const t = this.ctx.currentTime;
    this.droneGain.gain.setTargetAtTime(0.2, t, 3);
    this.padGain.gain.setTargetAtTime(0.15, t, 4);
  }

  // ------------------------------------------------------------ per-frame update
  update(dt, cam, fwd, s) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const L = ctx.listener;
    if (L.positionX) {
      L.positionX.setTargetAtTime(cam.x, t, 0.02); L.positionY.setTargetAtTime(cam.y, t, 0.02); L.positionZ.setTargetAtTime(cam.z, t, 0.02);
      L.forwardX.setTargetAtTime(fwd.x, t, 0.02); L.forwardY.setTargetAtTime(fwd.y, t, 0.02); L.forwardZ.setTargetAtTime(fwd.z, t, 0.02);
      L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else { L.setPosition(cam.x, cam.y, cam.z); L.setOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0); }

    this.buzzGain.gain.setTargetAtTime(Math.min(0.05, s.lightNear * 0.05), t, 0.1);

    // CEO presence
    if (s.ceo && s.ceoActive && !s.ceoHuman) {
      const p = this.ceoPanner;
      p.positionX.setTargetAtTime(s.ceo.x, t, 0.05); p.positionY.setTargetAtTime(2.1, t, 0.05); p.positionZ.setTargetAtTime(s.ceo.z, t, 0.05);
      this.breathT += dt * (s.ceoChasing ? 2.4 : 0.9);
      const cyc = Math.max(0, Math.sin(this.breathT));
      const level = (s.ceoChasing ? 0.9 : 0.45) * cyc;
      this.ceoBreath.gain.setTargetAtTime(level, t, 0.08);
      this.ceoBreathFilter.frequency.setTargetAtTime(380 + cyc * 300, t, 0.1);
      this.ceoGrowl.gain.setTargetAtTime(s.ceoChasing ? 0.35 : 0.12 * cyc, t, 0.2);
    } else { this.ceoBreath.gain.setTargetAtTime(0, t, 0.3); this.ceoGrowl.gain.setTargetAtTime(0, t, 0.3); }

    // Chase music
    this.chaseTarget = s.chaseIntensity;
    this.chase += (this.chaseTarget - this.chase) * Math.min(1, dt * (this.chaseTarget > this.chase ? 3 : 0.5));
    this.chaseGain.gain.setTargetAtTime(this.musicTracks ? 0 : this.chase * 0.9, t, 0.1);
    if (this.chase > 0.05 && !this.musicTracks) {
      this.nextPulse -= dt;
      if (this.nextPulse <= 0) {
        this.nextPulse = 60 / 165 / 2;
        this.pulseN = (this.pulseN || 0) + 1;
        const accent = this.pulseN % 4 === 0;
        this.tone({ type: 'sawtooth', freq: accent ? 55 : 41.2, freqEnd: 30, dur: 0.16, gain: 0.35 * this.chase * (accent ? 1.4 : 1), verb: 0.1, bus: this.music });
        if (this.pulseN % 8 === 0) this.noise({ type: 'highpass', freq: 5000, dur: 0.08, gain: 0.15 * this.chase, verb: 0.1 });
      }
    }

    // Heartbeat with danger
    this.danger = s.danger;
    if (s.danger > 0.15 && s.alive) {
      this.heartT -= dt;
      if (this.heartT <= 0) {
        this.heartT = 1.1 - s.danger * 0.65;
        const g = 0.25 + s.danger * 0.5;
        this.tone({ freq: 60, freqEnd: 38, dur: 0.14, gain: g, verb: 0 });
        this.tone({ freq: 55, freqEnd: 35, dur: 0.14, gain: g * 0.7, delay: 0.17, verb: 0 });
      }
    }

    // Random distant noises
    this.ambientT -= dt;
    if (this.ambientT <= 0 && this.theme !== 'office') {
      this.ambientT = 12 + Math.random() * 25;
      const a = Math.random() * Math.PI * 2, d = 12 + Math.random() * 16;
      const at = [cam.x + Math.cos(a) * d, 1.5, cam.z + Math.sin(a) * d];
      const pick = Math.floor(Math.random() * 5);
      if (pick === 0) { this.tone({ type: 'square', freq: 180 + Math.random() * 200, freqEnd: 90, dur: 0.6, gain: 0.08, at, verb: 0.8 }); this.noise({ freq: 3000, type: 'bandpass', q: 8, dur: 0.5, gain: 0.15, at, verb: 0.8 }); }
      else if (pick === 1) { for (let i = 0; i < 3; i++) this.noise({ freq: 300, dur: 0.12, gain: 0.35, at, verb: 0.9, delay: i * 0.28 }); }
      else if (pick === 2) this.whisper(at);
      else if (pick === 3) this.noise({ type: 'bandpass', freq: 800, freqEnd: 200, q: 4, dur: 2.2, gain: 0.12, attack: 0.8, at, verb: 0.9 });
      else this.tone({ type: 'sine', freq: 600 + Math.random() * 600, freqEnd: 300, dur: 1.6, gain: 0.03, attack: 0.5, at, verb: 1 });
    }
  }

  // ---- ending: outdoor night ambience and the car
  outdoor(on) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    if (on && !this.outdoorNodes) {
      const src = ctx.createBufferSource(); src.buffer = this.brownBuf; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
      const g = ctx.createGain(); g.gain.value = 0; g.gain.setTargetAtTime(0.25, t, 1.5);
      src.connect(f); f.connect(g); g.connect(this.amb); src.start();
      this.outdoorNodes = { src, g };
      this.crickets = setInterval(() => { for (let i = 0; i < 3; i++) this.tone({ type: 'sine', freq: 4200 + Math.random() * 300, dur: 0.04, gain: 0.025, delay: i * 0.06, verb: 0.2 }); }, 900);
      // the facility hum and the dread fade away
      for (const gn of [this.droneGain, this.padGain, this.airGain, this.buzzGain]) gn.gain.setTargetAtTime(0, t, 1.2);
      this.ceoBreath.gain.setTargetAtTime(0, t, 0.2); this.ceoGrowl.gain.setTargetAtTime(0, t, 0.2);
    } else if (!on && this.outdoorNodes) {
      this.outdoorNodes.g.gain.setTargetAtTime(0, t, 0.5);
      const n = this.outdoorNodes; setTimeout(() => n.src.stop(), 2000);
      this.outdoorNodes = null; clearInterval(this.crickets);
    }
  }

  engine(on, rpm = 0) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    if (on && !this.engineNodes) {
      this.tone({ type: 'sawtooth', freq: 40, freqEnd: 95, dur: 0.9, gain: 0.3, attack: 0.05 }); // starter crank
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 38;
      const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 19;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 220;
      const g = ctx.createGain(); g.gain.value = 0; g.gain.setTargetAtTime(0.22, t + 0.6, 0.3);
      o.connect(f); o2.connect(f); f.connect(g); g.connect(this.sfx); o.start(); o2.start();
      this.engineNodes = { o, o2, f, g };
    }
    if (this.engineNodes) {
      const n = this.engineNodes;
      if (!on) { n.g.gain.setTargetAtTime(0, t, 0.6); setTimeout(() => { n.o.stop(); n.o2.stop(); }, 2500); this.engineNodes = null; return; }
      n.o.frequency.setTargetAtTime(38 + rpm * 70, t, 0.2); n.o2.frequency.setTargetAtTime(19 + rpm * 35, t, 0.2);
      n.f.frequency.setTargetAtTime(220 + rpm * 500, t, 0.2);
    }
  }

  whisper(at) {
    for (let i = 0; i < 6; i++) this.noise({ type: 'bandpass', freq: 1500 + Math.random() * 2500, q: 6, dur: 0.18 + Math.random() * 0.2, gain: 0.08, attack: 0.05, at, verb: 0.9, delay: i * 0.22 + Math.random() * 0.1 });
  }

  // ------------------------------------------------------------ one-shots
  footstep(surface, at, mode, own = false) {
    const loud = mode === 'sprint' ? 1.5 : mode === 'crouch' ? 0.35 : 1;
    const g = (own ? 0.22 : 0.4) * loud;
    if (surface === 'carpet') this.noise({ type: 'lowpass', freq: 500, dur: 0.12, gain: g * 0.9, at, verb: 0.1 });
    else if (surface === 'metal') { this.noise({ type: 'bandpass', freq: 2600, q: 3, dur: 0.08, gain: g, at, verb: 0.4 }); this.tone({ type: 'triangle', freq: 320 + Math.random() * 60, dur: 0.15, gain: g * 0.25, at, verb: 0.4 }); }
    else if (surface === 'marble' || surface === 'tile') { this.noise({ type: 'bandpass', freq: 1800, q: 1.5, dur: 0.06, gain: g, at, verb: 0.5 }); this.noise({ type: 'lowpass', freq: 400, dur: 0.1, gain: g * 0.6, at, verb: 0.2 }); }
    else this.noise({ type: 'lowpass', freq: 1100, dur: 0.1, gain: g, at, verb: 0.35 });
  }

  ceoStep(at, speed) {
    const g = speed > 3 ? 1.1 : 0.7;
    this.tone({ freq: 70, freqEnd: 32, dur: 0.25, gain: g, at, verb: 0.6 });
    this.noise({ type: 'lowpass', freq: 260, dur: 0.18, gain: g * 0.8, at, verb: 0.5 });
    if (Math.random() < 0.4) this.noise({ type: 'bandpass', freq: 3200, q: 4, dur: 0.07, gain: 0.12, at, verb: 0.4, delay: 0.05 }); // claws tick
  }

  stinger() {
    for (const f of [146.8, 155.6, 207.6, 311]) this.tone({ type: 'sawtooth', freq: f, freqEnd: f * 0.94, dur: 1.8, gain: 0.12, attack: 0.02, verb: 0.6, bus: this.music });
    this.noise({ type: 'lowpass', freq: 200, dur: 1.2, gain: 0.8, verb: 0.7, brown: true });
  }

  scream(at) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(900, t); o.frequency.exponentialRampToValueAtTime(220, t + 1.4);
    const vib = ctx.createOscillator(); vib.frequency.value = 23; const vg = ctx.createGain(); vg.gain.value = 60; vib.connect(vg); vg.connect(o.frequency);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1200; f.Q.value = 2;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.9, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
    o.connect(f); f.connect(g); this.out(g, at, 0.6);
    o.start(t); vib.start(t); o.stop(t + 1.6); vib.stop(t + 1.6);
    this.noise({ type: 'highpass', freq: 1500, dur: 1.2, gain: 0.5, at, verb: 0.5 });
  }

  play(name, at) {
    if (!this.ready) return;
    const A = at ? [at[0], 1.2, at[1]] : null;
    switch (name) {
      case 'door': this.noise({ type: 'bandpass', freq: 900, freqEnd: 400, q: 2, dur: 0.6, gain: 0.35, at: A, verb: 0.4, attack: 0.05 }); break;
      case 'doorHeavy': this.noise({ type: 'lowpass', freq: 300, freqEnd: 120, dur: 1.4, gain: 0.7, at: A, verb: 0.7, attack: 0.1, brown: true }); this.tone({ freq: 55, dur: 1.2, gain: 0.3, at: A }); break;
      case 'keycard': this.tone({ type: 'square', freq: 1320, dur: 0.08, gain: 0.12, at: A }); this.tone({ type: 'square', freq: 1760, dur: 0.12, gain: 0.12, at: A, delay: 0.09 }); break;
      case 'denied': this.tone({ type: 'square', freq: 220, dur: 0.35, gain: 0.14, at: A }); break;
      case 'beep': this.tone({ type: 'square', freq: 990, dur: 0.1, gain: 0.08, at: A }); break;
      case 'pickup': this.tone({ freq: 880, dur: 0.12, gain: 0.12 }); this.tone({ freq: 1320, dur: 0.2, gain: 0.1, delay: 0.08 }); break;
      case 'switch': this.noise({ type: 'lowpass', freq: 600, dur: 0.15, gain: 0.8, at: A, verb: 0.6 }); this.tone({ type: 'square', freq: 90, dur: 0.1, gain: 0.25, at: A }); break;
      case 'lever': this.noise({ type: 'bandpass', freq: 500, freqEnd: 200, q: 3, dur: 0.9, gain: 0.5, at: A, verb: 0.6 }); break;
      case 'bang': this.noise({ type: 'lowpass', freq: 1500, dur: 0.4, gain: 1.0, at: A, verb: 0.9 }); this.tone({ freq: 60, freqEnd: 30, dur: 0.5, gain: 0.5, at: A }); break;
      case 'valve': this.noise({ type: 'highpass', freq: 2500, dur: 1.4, gain: 0.22, at: A, verb: 0.4, attack: 0.2 }); break;
      case 'alarm': for (let i = 0; i < 4; i++) this.tone({ type: 'sawtooth', freq: 600, freqEnd: 1100, dur: 0.45, gain: 0.18, at: A, verb: 0.6, delay: i * 0.5 }); break;
      case 'powerup': this.tone({ type: 'sawtooth', freq: 60, freqEnd: 480, dur: 2.2, gain: 0.15, attack: 0.3, verb: 0.6 }); this.noise({ type: 'lowpass', freq: 200, dur: 1.5, gain: 0.5, attack: 0.1, brown: true }); break;
      case 'powerdown': this.tone({ type: 'sawtooth', freq: 400, freqEnd: 40, dur: 2.5, gain: 0.15, verb: 0.6 }); this.noise({ type: 'lowpass', freq: 300, dur: 0.6, gain: 0.8, brown: true }); break;
      case 'vault': this.noise({ type: 'lowpass', freq: 200, dur: 2, gain: 0.9, at: A, verb: 0.8, attack: 0.2, brown: true }); this.tone({ freq: 45, dur: 1.5, gain: 0.4, at: A }); break;
      case 'copier': for (let i = 0; i < 6; i++) this.noise({ type: 'bandpass', freq: 1200, q: 2, dur: 0.2, gain: 0.2, at: A, delay: i * 0.25 }); break;
      case 'insert': this.noise({ type: 'bandpass', freq: 2000, q: 3, dur: 0.1, gain: 0.3, at: A }); this.tone({ freq: 660, dur: 0.1, gain: 0.08, at: A, delay: 0.1 }); break;
      case 'purge': this.noise({ type: 'bandpass', freq: 400, freqEnd: 1200, q: 0.8, dur: 3, gain: 0.5, attack: 0.5, verb: 0.6 }); break;
      case 'generator': this.noise({ type: 'lowpass', freq: 180, dur: 3, gain: 1.0, at: A, attack: 0.3, verb: 0.8, brown: true }); this.tone({ type: 'sawtooth', freq: 30, freqEnd: 60, dur: 3, gain: 0.3, at: A, attack: 0.5 }); break;
      case 'slam': this.noise({ type: 'lowpass', freq: 400, dur: 1.2, gain: 1.2, verb: 1 }); this.tone({ freq: 40, freqEnd: 25, dur: 1.2, gain: 0.8 }); break;
      case 'furnace': this.noise({ type: 'lowpass', freq: 600, freqEnd: 300, dur: 7, gain: 0.9, attack: 0.6, verb: 0.6, brown: true }); this.scream(null); setTimeout(() => this.scream(null), 1800); break;
      case 'roar': this.tone({ type: 'sawtooth', freq: 120, freqEnd: 55, dur: 1.6, gain: 0.5, at: A, verb: 0.8, attack: 0.05 }); this.noise({ type: 'bandpass', freq: 700, freqEnd: 300, q: 1.2, dur: 1.6, gain: 0.6, at: A, verb: 0.8 }); break;
      case 'elevator': this.tone({ freq: 55, dur: 4.5, gain: 0.25, attack: 0.6 }); this.noise({ type: 'lowpass', freq: 150, dur: 4.5, gain: 0.5, attack: 0.5, brown: true }); break;
      case 'ding': this.tone({ freq: 1046, dur: 1.2, gain: 0.15, verb: 0.6 }); this.tone({ freq: 784, dur: 1.4, gain: 0.15, delay: 0.25, verb: 0.6 }); break;
      case 'flashlight': this.noise({ type: 'bandpass', freq: 3000, q: 4, dur: 0.03, gain: 0.25 }); break;
      case 'hide': this.noise({ type: 'bandpass', freq: 700, q: 2, dur: 0.3, gain: 0.3, at: A, verb: 0.3 }); this.tone({ type: 'triangle', freq: 200, dur: 0.2, gain: 0.08, at: A }); break;
      case 'locker': this.noise({ type: 'bandpass', freq: 1200, q: 5, dur: 0.5, gain: 0.5, at: A, verb: 0.5 }); this.tone({ type: 'square', freq: 140, freqEnd: 90, dur: 0.4, gain: 0.2, at: A }); break;
      case 'jumpscare': this.noise({ type: 'highpass', freq: 800, dur: 1.4, gain: 1.4, verb: 0.3 }); this.tone({ type: 'sawtooth', freq: 440, freqEnd: 110, dur: 1.4, gain: 0.6 }); this.tone({ type: 'square', freq: 466, freqEnd: 117, dur: 1.4, gain: 0.4 }); break;
      case 'hurt': this.noise({ type: 'bandpass', freq: 900, q: 1, dur: 0.25, gain: 0.3 }); break;
      case 'cough': for (let i = 0; i < 2; i++) this.noise({ type: 'bandpass', freq: 700, q: 1.5, dur: 0.18, gain: 0.35, delay: i * 0.25 }); break;
      case 'breath': this.noise({ type: 'bandpass', freq: 900, q: 1, dur: 0.6, gain: 0.08, attack: 0.25, verb: 0 }); break;
      case 'ui': this.tone({ type: 'triangle', freq: 660, dur: 0.06, gain: 0.08 }); break;
      case 'heel': this.noise({ type: 'bandpass', freq: 2800, q: 2.5, dur: 0.05, gain: 0.5, at: A ? [A[0], 0.1, A[2]] : null, verb: 0.5 }); this.noise({ type: 'lowpass', freq: 500, dur: 0.06, gain: 0.25, at: A ? [A[0], 0.1, A[2]] : null, verb: 0.2 }); break;
      case 'transform':
        for (let i = 0; i < 9; i++) this.noise({ type: 'bandpass', freq: 1200 + Math.random() * 2500, q: 6, dur: 0.06, gain: 0.7, at: A, verb: 0.4, delay: i * 0.11 + Math.random() * 0.05 }); // bones cracking
        this.tone({ type: 'sawtooth', freq: 90, freqEnd: 260, dur: 1.4, gain: 0.35, attack: 0.3, at: A, verb: 0.7 });
        this.noise({ type: 'lowpass', freq: 300, freqEnd: 900, dur: 1.5, gain: 0.6, attack: 0.4, at: A, verb: 0.6, brown: true });
        break;
      case 'elevatorLeave': this.tone({ freq: 60, freqEnd: 40, dur: 4, gain: 0.25, attack: 0.5 }); this.noise({ type: 'lowpass', freq: 160, dur: 4, gain: 0.4, attack: 0.5, brown: true }); break;
      case 'carDoor': this.noise({ type: 'lowpass', freq: 700, dur: 0.25, gain: 0.9, verb: 0.15 }); this.tone({ freq: 90, freqEnd: 50, dur: 0.2, gain: 0.4, verb: 0.1 }); break;
      case 'carDoorOpen': this.noise({ type: 'bandpass', freq: 1500, q: 3, dur: 0.12, gain: 0.4, verb: 0.2 }); break;
      case 'keys': for (let i = 0; i < 4; i++) this.tone({ type: 'triangle', freq: 3000 + Math.random() * 2000, dur: 0.08, gain: 0.05, delay: i * 0.07 }); break;
      case 'stepOutside': this.noise({ type: 'bandpass', freq: 1400, q: 1.2, dur: 0.07, gain: 0.25, verb: 0.05 }); break;
      case 'screech': this.tone({ type: 'sawtooth', freq: 900, freqEnd: 1700, dur: 0.9, gain: 0.35, at: A, verb: 0.8, attack: 0.02 }); this.tone({ type: 'square', freq: 1310, freqEnd: 600, dur: 1.3, gain: 0.18, at: A, verb: 0.8, delay: 0.15 }); this.noise({ type: 'bandpass', freq: 2400, freqEnd: 900, q: 1.5, dur: 1.4, gain: 0.6, at: A, verb: 0.8 }); break;
      case 'gasp': this.noise({ type: 'bandpass', freq: 1100, freqEnd: 600, q: 1.2, dur: 0.5, gain: 0.5, at: A, verb: 0.4, attack: 0.02 }); this.tone({ type: 'triangle', freq: 330, freqEnd: 180, dur: 0.5, gain: 0.15, at: A }); break;
      case 'stunReady': this.tone({ type: 'triangle', freq: 880, dur: 0.12, gain: 0.06 }); this.tone({ type: 'triangle', freq: 1320, dur: 0.18, gain: 0.06, delay: 0.1 }); break;
      case 'ventBang': this.noise({ type: 'bandpass', freq: 600, q: 4, dur: 0.25, gain: 0.7, at: A, verb: 0.7 }); this.tone({ type: 'square', freq: 110, freqEnd: 70, dur: 0.2, gain: 0.25, at: A }); break;
      case 'staple': this.noise({ type: 'bandpass', freq: 2600, q: 3, dur: 0.05, gain: 0.7, at: A, verb: 0.3 }); this.noise({ type: 'lowpass', freq: 700, dur: 0.08, gain: 0.5, at: A, verb: 0.2 }); this.tone({ type: 'square', freq: 1800, freqEnd: 900, dur: 0.04, gain: 0.06, at: A }); break;
      case 'stapleHit': this.noise({ type: 'bandpass', freq: 900, q: 2, dur: 0.12, gain: 0.6, at: A, verb: 0.4 }); this.tone({ type: 'triangle', freq: 220, freqEnd: 110, dur: 0.12, gain: 0.2, at: A }); break;
      case 'stapleWall': this.noise({ type: 'bandpass', freq: 3800, q: 5, dur: 0.05, gain: 0.35, at: A, verb: 0.5 }); break;
      case 'staplerOpen': this.noise({ type: 'bandpass', freq: 1700, q: 4, dur: 0.12, gain: 0.35, at: A, verb: 0.3 }); this.tone({ type: 'square', freq: 600, freqEnd: 900, dur: 0.06, gain: 0.05, at: A, delay: 0.05 }); break;
      case 'staplerLoad': this.noise({ type: 'bandpass', freq: 2200, q: 3, dur: 0.07, gain: 0.45, at: A, verb: 0.3 }); this.noise({ type: 'lowpass', freq: 900, dur: 0.1, gain: 0.45, at: A, verb: 0.3, delay: 0.12 }); break;
      case 'dry': this.noise({ type: 'bandpass', freq: 3200, q: 6, dur: 0.03, gain: 0.3, at: A, verb: 0.1 }); break;
      case 'medkit': this.noise({ type: 'bandpass', freq: 1800, q: 2, dur: 0.25, gain: 0.25, at: A, verb: 0.2 }); this.noise({ type: 'highpass', freq: 3000, dur: 0.6, gain: 0.08, at: A, delay: 0.25, attack: 0.1 }); break;
      case 'slurp': for (let i = 0; i < 3; i++) this.noise({ type: 'bandpass', freq: 600 + i * 120, freqEnd: 1100, q: 3, dur: 0.22, gain: 0.25, at: A, verb: 0.1, delay: i * 0.28, attack: 0.04 }); this.tone({ type: 'sine', freq: 300, freqEnd: 180, dur: 0.15, gain: 0.08, at: A, delay: 0.95 }); break;
      case 'thud': this.noise({ type: 'lowpass', freq: 250, dur: 0.35, gain: 1.2, at: A, verb: 0.8 }); this.tone({ freq: 55, freqEnd: 30, dur: 0.3, gain: 0.6, at: A }); break;
      default: break;
    }
  }
}
