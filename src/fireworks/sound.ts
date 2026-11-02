import { Rng } from './rng'
import type { SoundCue } from './director'

interface MusicAnalyserState {
  analyser: AnalyserNode
  freqData: Uint8Array<ArrayBuffer>
  source: MediaElementAudioSourceNode
}

export class SoundEngine {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private noiseBuffer: AudioBuffer | null = null
  private fx: { dry: AudioNode; reverb: ConvolverNode } | null = null
  private music: MusicAnalyserState | null = null
  private rng = new Rng()
  private enabled = true
  private volume = 0.7

  private onsetHistory: number[] = []
  private lastOnsetAt = 0
  private prevLow = 0
  private prevMid = 0

  get context(): AudioContext | null {
    return this.ctx
  }

  ensure(): AudioContext {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) throw new Error('Web Audio API unavailable')
      this.ctx = new Ctor()
      this.master = this.ctx.createGain()
      this.master.gain.value = this.volume
      this.master.connect(this.ctx.destination)
      this.noiseBuffer = this.makeNoiseBuffer(this.ctx, 2.4)
    }
    return this.ctx
  }

  resume(): Promise<void> {
    const ctx = this.ensure()
    return ctx.state === 'suspended' ? ctx.resume() : Promise.resolve()
  }

  setEnabled(on: boolean): void {
    this.enabled = on
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(on ? this.volume : 0, this.ctx.currentTime, 0.05)
    }
  }

  setVolume(v: number): void {
    this.volume = v
    if (this.master && this.ctx && this.enabled) {
      this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05)
    }
  }

  attachMusic(element: HTMLMediaElement): void {
    const ctx = this.ensure()
    if (this.music && this.music.source.mediaElement === element) return
    this.detachMusic()
    try {
      const src = ctx.createMediaElementSource(element)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 2048
      analyser.smoothingTimeConstant = 0.55
      src.connect(analyser)
      src.connect(this.master!)
      this.music = {
        analyser,
        source: src,
        freqData: new Uint8Array(analyser.frequencyBinCount),
      }
    } catch {
      this.music = null
    }
  }

  detachMusic(): void {
    if (this.music) {
      try {
        this.music.source.disconnect()
      } catch {
        /* already disconnected */
      }
    }
    this.music = null
    this.onsetHistory = []
  }

  private makeNoiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * seconds)
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
    return buf
  }

  // ------------------------------------------------------------ effects bus

  private fxBus(): AudioNode | null {
    const ctx = this.ctx
    if (!ctx || !this.master) return null
    if (!this.fx) {
      const comp = ctx.createDynamicsCompressor()
      comp.threshold.value = -14
      comp.knee.value = 12
      comp.ratio.value = 6
      comp.attack.value = 0.002
      comp.release.value = 0.25
      comp.connect(this.master)
      const reverb = ctx.createConvolver()
      reverb.buffer = this.makeImpulse(ctx, 3.2)
      const wet = ctx.createGain()
      wet.gain.value = 0.55
      reverb.connect(wet).connect(comp)
      this.fx = { dry: comp, reverb }
    }
    return this.fx.dry
  }

  /** outdoor slap-back + long decay: noisy impulse with a few discrete echoes */
  private makeImpulse(ctx: AudioContext, seconds: number): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * seconds)
    const buf = ctx.createBuffer(2, len, ctx.sampleRate)
    const echoes = [0.11, 0.27, 0.46, 0.8]
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch)
      for (let i = 0; i < len; i++) {
        const t = i / ctx.sampleRate
        d[i] = (Math.random() * 2 - 1) * Math.exp(-t * 2.1) * 0.35 * Math.min(1, t * 40)
      }
      for (const e of echoes) {
        const at = Math.floor((e + ch * 0.013) * ctx.sampleRate)
        for (let k = 0; k < 600 && at + k < len; k++) d[at + k] += (Math.random() * 2 - 1) * Math.exp(-k / 120) * 0.6 * Math.exp(-e * 1.5)
      }
    }
    return buf
  }

  /** gain node routed through pan → dry + reverb send */
  private voice(when: number, pan: number, wet: number): GainNode | null {
    const ctx = this.ctx
    const dry = this.fxBus()
    if (!ctx || !dry || !this.fx) return null
    const g = ctx.createGain()
    const p = ctx.createStereoPanner()
    p.pan.setValueAtTime(Math.max(-1, Math.min(1, pan)), when)
    g.connect(p)
    p.connect(dry)
    const send = ctx.createGain()
    send.gain.value = wet
    p.connect(send).connect(this.fx.reverb)
    return g
  }

  private noise(when: number, dur: number, offset = Math.random() * 1.5): AudioBufferSourceNode | null {
    const ctx = this.ctx
    if (!ctx || !this.noiseBuffer) return null
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuffer
    src.loop = true
    src.start(when, offset)
    src.stop(when + dur + 0.05)
    return src
  }

  /**
   * The "report" of a breaking shell: sharp broadband crack + low body + rumble.
   * sharp > 1 → brighter/cracklier (salutes), < 1 → duller (big soft shells).
   */
  private report(when: number, size: number, sharp: number, pan: number, rumble = 1, wet = 0.5): void {
    const ctx = this.ctx
    if (!ctx) return
    const out = this.voice(when, pan, wet)
    if (!out) return

    // crack
    const n = this.noise(when, 0.6)
    if (n) {
      const hp = ctx.createBiquadFilter()
      hp.type = 'highpass'
      hp.frequency.value = 120
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.setValueAtTime(Math.min(16000, 5200 * sharp), when)
      lp.frequency.exponentialRampToValueAtTime(500, when + 0.18)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0, when)
      g.gain.linearRampToValueAtTime(0.9 * size * Math.min(1.6, sharp), when + 0.0015)
      g.gain.exponentialRampToValueAtTime(0.0008, when + 0.16 + 0.12 * size)
      n.connect(hp).connect(lp).connect(g).connect(out)
    }

    // body thump
    const o = ctx.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(110 / Math.sqrt(Math.max(0.4, size)), when)
    o.frequency.exponentialRampToValueAtTime(34, when + 0.45)
    const og = ctx.createGain()
    og.gain.setValueAtTime(0, when)
    og.gain.linearRampToValueAtTime(0.95 * size, when + 0.006)
    og.gain.exponentialRampToValueAtTime(0.0006, when + 0.7 + size * 0.5)
    o.connect(og).connect(out)
    o.start(when)
    o.stop(when + 1.4 + size * 0.5)

    // rolling rumble
    const rd = (1.2 + size * 1.4) * rumble
    const rn = this.noise(when, rd + 0.1)
    if (rn) {
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.setValueAtTime(420, when)
      lp.frequency.exponentialRampToValueAtTime(90, when + rd)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0, when)
      g.gain.linearRampToValueAtTime(0.55 * size * rumble, when + 0.03)
      g.gain.exponentialRampToValueAtTime(0.0005, when + rd)
      rn.connect(lp).connect(g).connect(out)
    }
  }

  /** many short clicks spread over time — crackling / popping stars */
  private crackleField(when: number, spread: number, grains: number, size: number, pan: number): void {
    const ctx = this.ctx
    if (!ctx) return
    const out = this.voice(when, pan, 0.35)
    if (!out) return
    const n = Math.min(70, Math.floor(grains))
    for (let i = 0; i < n; i++) {
      // clusters, like real dragon-egg stars popping in waves
      const t = when + spread * Math.pow(this.rng.next(), 0.7)
      const src = this.noise(t, 0.05)
      if (!src) continue
      const bp = ctx.createBiquadFilter()
      bp.type = 'bandpass'
      bp.frequency.value = this.rng.range(1800, 5200)
      bp.Q.value = 0.8
      const g = ctx.createGain()
      const amp = this.rng.range(0.12, 0.42) * size
      g.gain.setValueAtTime(0, t)
      g.gain.linearRampToValueAtTime(amp, t + 0.0012)
      g.gain.exponentialRampToValueAtTime(0.0003, t + this.rng.range(0.015, 0.05))
      src.connect(bp).connect(g).connect(out)
    }
  }

  /** falling glitter / willow hiss */
  private sizzle(when: number, dur: number, level: number, pan: number, freq = 6500): void {
    const ctx = this.ctx
    if (!ctx) return
    const out = this.voice(when, pan, 0.3)
    const src = this.noise(when, dur)
    if (!out || !src) return
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = freq
    bp.Q.value = 0.7
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, when)
    g.gain.linearRampToValueAtTime(level, when + dur * 0.25)
    g.gain.linearRampToValueAtTime(level * 0.6, when + dur * 0.7)
    g.gain.linearRampToValueAtTime(0, when + dur)
    src.connect(bp).connect(g).connect(out)
  }

  // ------------------------------------------------------------ public

  /** mortar lift: low thump, optional screaming whistle */
  playLaunch(cue: { fuse: number; whistle: boolean; pan: number; gain: number; delay: number }): void {
    if (!this.enabled || !this.ctx) return
    const ctx = this.ctx
    const when = ctx.currentTime + cue.delay
    const out = this.voice(when, cue.pan, 0.3)
    if (!out) return
    const n = this.noise(when, 0.4)
    if (n) {
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 260
      const g = ctx.createGain()
      g.gain.setValueAtTime(0, when)
      g.gain.linearRampToValueAtTime(0.7 * cue.gain, when + 0.004)
      g.gain.exponentialRampToValueAtTime(0.0005, when + 0.3)
      n.connect(lp).connect(g).connect(out)
    }
    const o = ctx.createOscillator()
    o.frequency.setValueAtTime(75, when)
    o.frequency.exponentialRampToValueAtTime(40, when + 0.15)
    const og = ctx.createGain()
    og.gain.setValueAtTime(0.5 * cue.gain, when)
    og.gain.exponentialRampToValueAtTime(0.0005, when + 0.22)
    o.connect(og).connect(out)
    o.start(when)
    o.stop(when + 0.25)

    if (cue.whistle) {
      // the whistle travels with the shell, roughly fuse long
      const w = ctx.createOscillator()
      w.type = 'triangle'
      const f0 = this.rng.range(1500, 2400)
      w.frequency.setValueAtTime(f0 * 0.75, when + 0.05)
      w.frequency.linearRampToValueAtTime(f0, when + 0.35)
      w.frequency.linearRampToValueAtTime(f0 * 0.82, when + cue.fuse)
      const vib = ctx.createOscillator()
      vib.frequency.value = this.rng.range(18, 32)
      const vg = ctx.createGain()
      vg.gain.value = f0 * 0.03
      vib.connect(vg).connect(w.frequency)
      const wg = ctx.createGain()
      wg.gain.setValueAtTime(0, when)
      wg.gain.linearRampToValueAtTime(0.07 * cue.gain, when + 0.15)
      wg.gain.setValueAtTime(0.07 * cue.gain, when + cue.fuse * 0.85)
      wg.gain.linearRampToValueAtTime(0, when + cue.fuse)
      w.connect(wg).connect(out)
      w.start(when)
      vib.start(when)
      w.stop(when + cue.fuse + 0.05)
      vib.stop(when + cue.fuse + 0.05)
    } else {
      // soft rising hiss of the burning lift trail
      this.sizzle(when + 0.05, cue.fuse * 0.8, 0.025 * cue.gain, cue.pan, 3200)
    }
  }

  playBurst(cue: SoundCue): void {
    if (!this.enabled || !this.ctx) return
    const when = this.ctx.currentTime + cue.delay
    const size = Math.min(1.6, (0.45 + cue.size * 0.55) * cue.gain)
    const pan = cue.pan
    switch (cue.kind) {
      case 'salute':
        this.report(when, size * 1.5, 2.6, pan, 1.3, 0.8)
        break
      case 'crackle':
        this.report(when, size * 0.85, 1.1, pan, 0.8)
        this.crackleField(when + cue.duration * 0.55, cue.duration * 0.5, 45 * Math.min(1.3, cue.size), size, pan)
        break
      case 'heavy':
        this.report(when, size * 1.1, 0.7, pan, 1.6, 0.65)
        this.sizzle(when + 0.2, cue.duration, 0.05 * size, pan)
        this.crackleField(when + 0.4, cue.duration * 0.8, 14, size * 0.35, pan)
        break
      case 'strobe':
        this.report(when, size * 0.7, 0.9, pan, 0.8)
        this.sizzle(when + 0.4, cue.duration * 0.8, 0.03 * size, pan, 8000)
        break
      case 'soft':
        this.report(when, size * 0.65, 0.85, pan, 0.7)
        break
      case 'pop':
        this.report(when, size * 0.5, 1.4, pan, 0.4, 0.4)
        break
      default:
        this.report(when, size, 1, pan)
    }
  }

  /** crackling stars dying (polled from the simulation) */
  playCrackle(amount: number): void {
    if (!this.enabled || !this.ctx) return
    this.crackleField(this.ctx.currentTime + 0.3, 0.2, 4 + amount * 22, 0.5 + amount * 0.4, this.rng.range(-0.4, 0.4))
  }

  /** crossette splits: dry sharp snaps */
  playSplit(amount: number): void {
    if (!this.enabled || !this.ctx) return
    const when = this.ctx.currentTime + 0.3
    const n = 2 + Math.round(amount * 6)
    for (let i = 0; i < n; i++) {
      this.report(when + this.rng.range(0, 0.12), 0.18 + amount * 0.15, 2.2, this.rng.range(-0.5, 0.5), 0.15, 0.4)
    }
  }

  sample(): { energy: number; low: number; mid: number; high: number; onset: boolean } {
    if (!this.music) {
      return { energy: 0, low: 0, mid: 0, high: 0, onset: false }
    }
    this.music.analyser.getByteFrequencyData(this.music.freqData)
    const bins = this.music.freqData.length
    let low = 0
    let mid = 0
    let high = 0
    for (let i = 0; i < bins; i++) {
      const v = this.music.freqData[i] / 255
      if (i < bins * 0.08) low += v
      else if (i < bins * 0.45) mid += v
      else high += v
    }
    low /= Math.max(1, bins * 0.08)
    mid /= Math.max(1, bins * 0.37)
    high /= Math.max(1, bins * 0.55)

    const energy = low * 0.5 + mid * 0.35 + high * 0.15

    const now = performance.now()
    const flux = Math.max(0, low - this.prevLow) + Math.max(0, mid - this.prevMid)
    this.onsetHistory.push(flux)
    if (this.onsetHistory.length > 32) this.onsetHistory.shift()
    const avg = this.onsetHistory.reduce((a, b) => a + b, 0) / this.onsetHistory.length
    const threshold = Math.max(0.035, avg * 1.9)

    const onset = flux > threshold && now - this.lastOnsetAt > 130
    if (onset) this.lastOnsetAt = now
    this.prevLow = low
    this.prevMid = mid

    return { energy, low, mid, high, onset }
  }

  dispose(): void {
    this.detachMusic()
    if (this.ctx) void this.ctx.close()
    this.ctx = null
    this.master = null
    this.noiseBuffer = null
    this.fx = null
  }
}
