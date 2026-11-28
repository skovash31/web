// Proximity voice chat (shared with the VR edition): 16 kHz mono mu-law frames of 40 ms,
// relayed by the server. Each speaker plays from where they stand: louder and clearer up
// close, quieter and more muffled with distance, muffled more through walls, silent past 25 m.
// The mic needs a secure page (http://localhost or https); elsewhere you can still listen.
const RATE = 16000, FRAME = 640, RANGE = 25;

const DEC = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const u = ~i & 0xff;
  let t = ((u & 0x0f) << 3) + 0x84;
  t <<= (u & 0x70) >> 4;
  DEC[i] = ((u & 0x80) ? 0x84 - t : t - 0x84) / 32768;
}
function mulaw(f) {
  let s = Math.max(-32768, Math.min(32767, Math.round(f * 32767)));
  const sign = (s >> 8) & 0x80;
  if (sign) s = -s;
  if (s > 32635) s = 32635;
  s += 0x84;
  let exp = 7;
  for (let mask = 0x4000; (s & mask) === 0 && exp > 0; exp--, mask >>= 1);
  const mant = (s >> (exp + 3)) & 0x0f;
  return ~(sign | (exp << 4) | mant) & 0xff;
}

export class Voice {
  constructor(audio, net) {
    this.audio = audio; this.net = net;
    this.speakers = new Map();
    this.muted = localStorage.getItem('catinc.mute') === '1';
    this.mic = null; this.talking = false; this.gateUntil = 0;
    this.pending = []; this.t = 0;
    this.status = 'off';
    net.on('voice', (m) => this.receive(m.id, m.d));
  }

  get canMic() { return !!(navigator.mediaDevices?.getUserMedia) && window.isSecureContext; }

  async enableMic() {
    if (this.mic || !this.audio.ctx) return;
    if (!this.canMic) { this.status = 'needs-https'; return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      const ctx = this.audio.ctx;
      const src = ctx.createMediaStreamSource(stream);
      const proc = ctx.createScriptProcessor(2048, 1, 1);
      const sink = ctx.createGain(); sink.gain.value = 0;      // keep the processor running, silently
      src.connect(proc); proc.connect(sink); sink.connect(ctx.destination);
      const step = ctx.sampleRate / RATE;
      proc.onaudioprocess = (e) => {
        const d = e.inputBuffer.getChannelData(0);
        for (; this.t < d.length - 1; this.t += step) { const i = this.t | 0, f = this.t - i; this.pending.push(d[i] + (d[i + 1] - d[i]) * f); }
        this.t -= d.length; if (this.t < 0) this.t = 0;
        while (this.pending.length >= FRAME) this.sendFrame(this.pending.splice(0, FRAME));
      };
      this.mic = { stream, src, proc };
      this.status = 'on';
    } catch (e) { this.status = 'denied'; console.warn('mic unavailable', e); }
  }

  sendFrame(frame) {
    let rms = 0;
    for (const v of frame) rms += v * v;
    rms = Math.sqrt(rms / FRAME);
    const now = performance.now();
    if (rms > 0.012) this.gateUntil = now + 450;
    this.talking = !this.muted && now < this.gateUntil && this.net.connected;
    if (!this.talking) return;
    const bytes = new Uint8Array(FRAME);
    for (let i = 0; i < FRAME; i++) bytes[i] = mulaw(Math.max(-1, Math.min(1, frame[i] * 1.4)));
    let bin = '';
    for (let i = 0; i < FRAME; i++) bin += String.fromCharCode(bytes[i]);
    this.net.volatile.emit('voice', btoa(bin));
  }

  setMuted(m) { this.muted = m; localStorage.setItem('catinc.mute', m ? '1' : '0'); }

  speaker(id) {
    let s = this.speakers.get(id);
    if (s) return s;
    const ctx = this.audio.ctx;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 7800;
    const gain = ctx.createGain();
    const pan = ctx.createPanner();
    pan.panningModel = 'HRTF'; pan.distanceModel = 'linear'; pan.refDistance = 1.2; pan.maxDistance = RANGE; pan.rolloffFactor = 1;
    lp.connect(gain); gain.connect(pan); pan.connect(this.audio.master);
    s = { lp, gain, pan, next: 0, last: 0 };
    this.speakers.set(id, s);
    return s;
  }

  receive(id, b64) {
    const ctx = this.audio.ctx;
    if (!ctx || typeof b64 !== 'string') return;
    let bin;
    try { bin = atob(b64); } catch { return; }
    const buf = ctx.createBuffer(1, bin.length, RATE);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < bin.length; i++) ch[i] = DEC[bin.charCodeAt(i)];
    const s = this.speaker(id);
    const now = ctx.currentTime;
    // small jitter buffer; skip ahead if latency piles up
    if (s.next < now + 0.03 || s.next > now + 0.5) s.next = now + 0.12;
    const src = ctx.createBufferSource(); src.buffer = buf; src.connect(s.lp); src.start(s.next);
    s.next += buf.duration;
    s.last = performance.now();
  }

  speaking(id) { const s = this.speakers.get(id); return !!s && performance.now() - s.last < 350; }

  // headOf(id) -> { x, y, z, blocked } in world space, or null to silence that speaker
  update(listener, headOf) {
    for (const [id, s] of this.speakers) {
      const h = headOf(id);
      if (!h) { s.gain.gain.value = 0; continue; }
      const d = Math.hypot(h.x - listener.x, h.y - listener.y, h.z - listener.z);
      const k = Math.min(1, d / RANGE);
      s.pan.positionX.value = h.x; s.pan.positionY.value = h.y; s.pan.positionZ.value = h.z;
      s.lp.frequency.value = (7800 + (1400 - 7800) * k) * (h.blocked ? 0.35 : 1);
      s.gain.gain.value = (h.blocked ? 0.5 : 1) * 1.6;
    }
  }

  remove(id) { const s = this.speakers.get(id); if (s) { s.pan.disconnect(); this.speakers.delete(id); } }
}
