// BREACHLINE — sound, synthesized. No audio files: every effect is an
// oscillator or filtered noise burst built in WebAudio at boot. Volume
// falls with distance from the player and pans by direction, so a shot
// across the map reads as distant and a shot behind you reads as behind.

export class SoundFX {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuf = null;
    this.ready = false;
  }

  // Must be called from a user gesture (the Deploy button).
  ensure() {
    if (this.ready) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.ready = true;
  }

  // Gain and pan for a world position heard by the player.
  spatial(state, x, z) {
    const p = state.player;
    const dx = x - p.pos.x, dz = z - p.pos.z;
    const d = Math.hypot(dx, dz);
    const gain = 1 / (1 + d * 0.09);
    // Pan: positive when the source is to the player's right.
    const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
    const rx = dx * cy - dz * sy;
    const pan = d > 0.5 ? Math.max(-0.8, Math.min(0.8, rx / d)) : 0;
    return { gain, pan };
  }

  tone(freq, dur, type, gain, pan, when = 0, slideTo = 0) {
    if (!this.ready) return;
    const t = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    const p = this.ctx.createStereoPanner();
    p.pan.value = pan;
    osc.connect(g).connect(p).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  noise(dur, freq, gain, pan, when = 0, sweepTo = 0, type = 'lowpass') {
    if (!this.ready) return;
    const t = this.ctx.currentTime + when;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const flt = this.ctx.createBiquadFilter();
    flt.type = type;
    flt.frequency.setValueAtTime(freq, t);
    if (sweepTo) flt.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    const p = this.ctx.createStereoPanner();
    p.pan.value = pan;
    src.connect(flt).connect(g).connect(p).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  handleEvent(state, ev) {
    if (!this.ready || state.muted) return;
    const p = state.player;
    switch (ev.kind) {
      case 'shot': {
        const f = state.fighters[ev.fighter];
        const own = f.isPlayer;
        const s = own ? { gain: 1, pan: 0 } : this.spatial(state, f.pos.x, f.pos.z);
        const heavy = ev.weapon === 'm870' || ev.weapon === 'dmr9';
        this.noise(heavy ? 0.16 : 0.09, heavy ? 900 : 1600, 0.55 * s.gain, s.pan);
        this.tone(heavy ? 70 : 110, 0.07, 'square', 0.25 * s.gain, s.pan, 0, 45);
        break;
      }
      case 'dry':
        this.tone(1300, 0.03, 'square', 0.12, 0);
        break;
      case 'reload':
        this.tone(900, 0.04, 'square', 0.15, 0, 0);
        this.tone(650, 0.05, 'square', 0.15, 0, 0.4);
        break;
      case 'reloaded':
        this.tone(1100, 0.05, 'square', 0.18, 0);
        break;
      case 'damaged': {
        const victim = state.fighters[ev.victim];
        if (victim.isPlayer) {
          this.tone(90, 0.12, 'sine', 0.5, 0, 0, 50);
          this.noise(0.08, 500, 0.3, 0);
        } else if (ev.attacker === p.id) {
          this.tone(ev.head ? 2600 : 2100, 0.035, 'square', 0.22, 0);
        }
        break;
      }
      case 'kill':
        if (ev.killer === p.id) {
          this.tone(880, 0.07, 'sine', 0.3, 0);
          this.tone(1320, 0.1, 'sine', 0.3, 0, 0.07);
        }
        break;
      case 'explosion': {
        const s = this.spatial(state, ev.x, ev.z);
        this.noise(0.8, 700, 0.8 * s.gain, s.pan, 0, 90);
        this.tone(48, 0.7, 'sine', 0.7 * s.gain, s.pan, 0, 30);
        break;
      }
      case 'detonation':
        this.noise(1.4, 500, 0.9, 0, 0, 60);
        this.tone(40, 1.2, 'sine', 0.9, 0, 0, 26);
        break;
      case 'flashbang': {
        const s = this.spatial(state, ev.x, ev.z);
        this.noise(0.12, 4000, 0.5 * s.gain, s.pan, 0, 0, 'highpass');
        if (state.time < p.flashUntil) this.tone(3200, 1.1, 'sine', 0.16, 0);
        break;
      }
      case 'throw':
        this.noise(0.18, 1200, 0.12, 0, 0, 300, 'bandpass');
        break;
      case 'step': {
        const f = state.fighters[ev.fighter];
        if (f.isPlayer) this.noise(0.05, 400, ev.loud ? 0.1 : 0.05, 0);
        break;
      }
      case 'beep':
        this.tone(ev.urgent ? 1200 : 880, 0.07, 'square', 0.16, 0);
        break;
      case 'planted':
        this.tone(520, 0.1, 'square', 0.25, 0);
        this.tone(780, 0.12, 'square', 0.25, 0, 0.1);
        break;
      case 'defused':
        this.tone(780, 0.1, 'square', 0.25, 0);
        this.tone(520, 0.14, 'square', 0.25, 0, 0.1);
        break;
      case 'roundEnd':
        if (ev.winner === 'vanguard') {
          this.tone(523, 0.12, 'sine', 0.3, 0);
          this.tone(659, 0.12, 'sine', 0.3, 0, 0.12);
          this.tone(784, 0.2, 'sine', 0.3, 0, 0.24);
        } else {
          this.tone(392, 0.16, 'sine', 0.3, 0);
          this.tone(311, 0.24, 'sine', 0.3, 0, 0.16);
        }
        break;
      case 'buy':
        this.tone(1567, 0.05, 'square', 0.14, 0);
        this.tone(2093, 0.07, 'square', 0.14, 0, 0.05);
        break;
      case 'roundLive':
        this.tone(660, 0.08, 'square', 0.2, 0);
        break;
      default:
        break;
    }
  }
}
