// Background music from the project's music/ folder: the base soundtrack, the chase theme
// and the elevator tune. Exactly one track is audible at a time: switching fades the old
// one out *before* the new one fades in. Base and elevator resume where they left off;
// the chase theme only restarts for a fresh chase, not when one flickers back on.
const TRACKS = {
  base: { file: 'Basesoundtrack.mp3', vol: 0.42 },
  chase: { file: 'chase.mp3', vol: 0.6 },
  elevator: { file: 'elevator.mp3', vol: 0.5 },
};
const FADE_OUT = { base: 0.45, elevator: 0.45, chase: 0.6 };   // seconds
const FADE_IN = { base: 1.4, elevator: 0.8, chase: 0.2 };
const CHASE_RESUME = 6; // a chase that restarts within this many seconds continues the track

export class Music {
  constructor(audio) {
    this.audio = audio;
    this.tracks = {};
    this.current = null;   // track key we want audible (null = silence)
    this.playing = null;   // track key currently audible / fading in
    this.ready = false;
    this.startTimer = null;
    this.chaseStoppedAt = -1e9;
  }

  // Needs the shared AudioContext, so call after the first user gesture (audio.init()).
  init() {
    const ctx = this.audio.ctx;
    if (this.ready || !ctx) return;
    this.ready = true;
    for (const [key, t] of Object.entries(TRACKS)) {
      const el = new window.Audio(`music/${t.file}`);
      el.loop = true;
      el.preload = 'auto';
      const g = ctx.createGain();
      g.gain.value = 0;
      try { ctx.createMediaElementSource(el).connect(g); } catch { continue; }
      g.connect(this.audio.master);
      const tr = { key, el, g, vol: t.vol, ok: false, pauseTimer: null };
      el.addEventListener('canplay', () => { tr.ok = true; if (key === 'chase') this.audio.musicTracks = true; }, { once: true });
      el.addEventListener('error', () => { tr.ok = false; });
      this.tracks[key] = tr;
    }
  }

  // Ask for a track (or null for silence). Cheap to call every frame.
  set(key) {
    if (!this.ready || key === this.current) return;
    const prev = this.current;
    this.current = key;
    const ctx = this.audio.ctx, now = ctx.currentTime;
    clearTimeout(this.startTimer);
    // fade out whatever is audible
    let wait = 0;
    for (const tr of Object.values(this.tracks)) {
      if (tr.key === key) continue;
      if (tr.g.gain.value > 0.001 || !tr.el.paused) {
        const f = FADE_OUT[tr.key];
        wait = Math.max(wait, f);
        tr.g.gain.cancelScheduledValues(now);
        tr.g.gain.setValueAtTime(tr.g.gain.value, now);
        tr.g.gain.linearRampToValueAtTime(0, now + f);
        clearTimeout(tr.pauseTimer);
        tr.pauseTimer = setTimeout(() => { if (this.current !== tr.key) tr.el.pause(); }, f * 1000 + 40);
      }
    }
    if (prev === 'chase') this.chaseStoppedAt = now;
    if (!key) { this.playing = null; return; }
    const tr = this.tracks[key];
    if (!tr) return;
    // a chase that ends and restarts within a few seconds keeps going; a new chase starts fresh
    if (key === 'chase' && now - this.chaseStoppedAt > CHASE_RESUME) { try { tr.el.currentTime = 0; } catch { /* not loaded yet */ } }
    // if this track was still audible (e.g. we only just left it), take it back without a gap
    if (tr.g.gain.value > 0.02 && !tr.el.paused) wait = 0;
    const start = () => {
      if (this.current !== key) return;
      clearTimeout(tr.pauseTimer);
      const t0 = ctx.currentTime;
      tr.g.gain.cancelScheduledValues(t0);
      tr.g.gain.setValueAtTime(tr.g.gain.value, t0);
      tr.g.gain.linearRampToValueAtTime(tr.vol, t0 + FADE_IN[key]);
      if (tr.el.paused) tr.el.play().catch(() => {});
      this.playing = key;
    };
    if (wait > 0) this.startTimer = setTimeout(start, wait * 1000 + 20); else start();
  }

  stopAll() { this.set(null); }
}
