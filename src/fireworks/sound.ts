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

  // ------------------------------------------------------------ sample generation
  //
  // No oscillators anywhere: a pitched sine sweep is what makes a synth kick
  // drum. A real report is an unpitched pressure pulse (N-wave) followed by
  // turbulent noise and terrain echo, so everything below is built from that.

  private bursts: AudioBuffer[] = []
  private clicks: AudioBuffer[] = []

  /**
   * One explosion "report". `body` (0..1) controls pulse length: longer pulse →
   * lower spectral peak → deeper boom. `bright` adds high-frequency blast noise.
   */
  private makeBurst(ctx: AudioContext, body: number, bright: number): AudioBuffer {
    const sr = ctx.sampleRate
    const len = Math.floor(sr * (0.9 + body * 0.9))
    const buf = ctx.createBuffer(1, len, sr)
    const d = buf.getChannelData(0)
    // N-wave: instant overpressure, linear fall through zero, recovery
    const T = (0.004 + body * 0.016) * sr
    for (let i = 0; i < T * 1.6 && i < len; i++) {
      const x = i / T
      d[i] += x < 1 ? 1 - 2 * x : -1 + (x - 1) / 0.6
    }
    // blast turbulence: noise with a very fast decay, lightly low-passed
    let lp = 0
    const kBlast = Math.exp((-2 * Math.PI * (2500 + bright * 6000)) / sr)
    for (let i = 0; i < len; i++) {
      const t = i / sr
      lp = lp * kBlast + (Math.random() * 2 - 1) * (1 - kBlast)
      d[i] += lp * 1.6 * Math.exp(-t / (0.018 + body * 0.02)) * (0.6 + bright)
    }
    // low rumble: twice low-passed noise, slower decay (the "ㅇ" of 펑)
    let l1 = 0
    let l2 = 0
    const kLow = Math.exp((-2 * Math.PI * (90 + (1 - body) * 120)) / sr)
    for (let i = 0; i < len; i++) {
      const t = i / sr
      l1 = l1 * kLow + (Math.random() * 2 - 1) * (1 - kLow)
      l2 = l2 * kLow + l1 * (1 - kLow)
      const env = Math.min(1, t / 0.004) * Math.exp(-t / (0.12 + body * 0.35))
      d[i] += l2 * 22 * env * (0.5 + body)
    }
    normalize(d, 0.95)
    return buf
  }

  /** a single crackle pop: sub-millisecond impulse plus a tiny noise tail */
  private makeClick(ctx: AudioContext): AudioBuffer {
    const sr = ctx.sampleRate
    const len = Math.floor(sr * 0.03)
    const buf = ctx.createBuffer(1, len, sr)
    const d = buf.getChannelData(0)
    const T = (0.0003 + Math.random() * 0.0007) * sr
    for (let i = 0; i < T * 1.6; i++) {
      const x = i / T
      d[i] = x < 1 ? 1 - 2 * x : -1 + (x - 1) / 0.6
    }
    for (let i = 0; i < len; i++) d[i] += (Math.random() * 2 - 1) * 0.5 * Math.exp(-i / (sr * 0.004))
    normalize(d, 0.95)
    return buf
  }

  private ensureSamples(): void {
    const ctx = this.ctx
    if (!ctx || this.bursts.length) return
    // a small bank of variants so repeated shells never sound identical
    for (let i = 0; i < 9; i++) {
      const body = (i % 3) / 2 // 0 small, 0.5 medium, 1 large
      this.bursts.push(this.makeBurst(ctx, body, 0.3 + Math.random() * 0.5))
    }
    for (let i = 0; i < 10; i++) this.clicks.push(this.makeClick(ctx))
  }

  // ------------------------------------------------------------ effects bus

  private fxBus(): AudioNode | null {
    const ctx = this.ctx
    if (!ctx || !this.master) return null
    if (!this.fx) {
      const comp = ctx.createDynamicsCompressor()
      comp.threshold.value = -16
      comp.knee.value = 10
      comp.ratio.value = 8
      comp.attack.value = 0.001
      comp.release.value = 0.3
      comp.connect(this.master)
      const reverb = ctx.createConvolver()
      reverb.buffer = this.makeImpulse(ctx, 4.5)
      const wet = ctx.createGain()
      wet.gain.value = 0.7
      reverb.connect(wet).connect(comp)
      this.fx = { dry: comp, reverb }
    }
    return this.fx.dry
  }

  /**
   * Outdoor echo: scattered early reflections (water, buildings, hills) and a
   * long tail that gets darker over time — the rolling "thunder" after a boom.
   */
  private makeImpulse(ctx: AudioContext, seconds: number): AudioBuffer {
    const sr = ctx.sampleRate
    const len = Math.floor(sr * seconds)
    const buf = ctx.createBuffer(2, len, sr)
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch)
      let lp = 0
      for (let i = 0; i < len; i++) {
        const t = i / sr
        // cutoff falls from ~5 kHz to ~250 Hz as the echo ages
        const fc = 250 + 4800 * Math.exp(-t * 2.2)
        const k = Math.exp((-2 * Math.PI * fc) / sr)
        lp = lp * k + (Math.random() * 2 - 1) * (1 - k)
        const swell = 0.7 + 0.3 * Math.sin(t * 5.3 + ch) * Math.sin(t * 2.1)
        d[i] = lp * 2.2 * Math.exp(-t * 1.25) * Math.min(1, t * 25) * swell
      }
      for (let e = 0; e < 14; e++) {
        const at = Math.floor(sr * (0.06 + Math.random() * 1.4))
        const amp = (0.25 + Math.random() * 0.35) * Math.exp(-at / sr)
        let elp = 0
        const ek = Math.exp((-2 * Math.PI * (600 + Math.random() * 1500)) / sr)
        for (let k = 0; k < sr * 0.06 && at + k < len; k++) {
          elp = elp * ek + (Math.random() * 2 - 1) * (1 - ek)
          d[at + k] += elp * 3 * amp * Math.exp(-k / (sr * 0.012))
        }
      }
    }
    return buf
  }

  /**
   * gain → air-absorption low-pass → pan → dry + reverb send.
   * Farther sources lose highs and are relatively more reverberant.
   */
  private voice(when: number, pan: number, wet: number, distance = 300): GainNode | null {
    const ctx = this.ctx
    const dry = this.fxBus()
    if (!ctx || !dry || !this.fx) return null
    const g = ctx.createGain()
    const air = ctx.createBiquadFilter()
    air.type = 'lowpass'
    air.Q.value = 0.5
    air.frequency.setValueAtTime(Math.max(700, 14000 * Math.exp(-distance / 260)), when)
    const p = ctx.createStereoPanner()
    p.pan.setValueAtTime(Math.max(-1, Math.min(1, pan)), when)
    g.connect(air).connect(p)
    const dryGain = ctx.createGain()
    dryGain.gain.value = Math.max(0.25, 1 - distance / 900)
    p.connect(dryGain).connect(dry)
    const send = ctx.createGain()
    send.gain.value = wet * Math.min(1.6, 0.6 + distance / 500)
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
   * Play an explosion report. size picks the sample bank (small/medium/large)
   * and loudness; playbackRate slightly varies so no two booms are identical.
   */
  private report(when: number, size: number, sharp: number, pan: number, distance: number, wet = 0.6): void {
    const ctx = this.ctx
    if (!ctx) return
    this.ensureSamples()
    const out = this.voice(when, pan, wet, distance / Math.max(0.6, sharp))
    if (!out) return
    const tier = size < 0.6 ? 0 : size < 1.05 ? 1 : 2
    const src = ctx.createBufferSource()
    src.buffer = this.bursts[tier + 3 * Math.floor(this.rng.next() * 3)]
    // bigger → slightly slower → deeper; sharp (salute) → faster, cracklier
    src.playbackRate.value = (0.92 + this.rng.next() * 0.16) * (sharp > 1.5 ? 1.25 : 1) / Math.sqrt(Math.max(0.5, size))
    const g = ctx.createGain()
    g.gain.value = Math.min(2.2, 0.9 * size * Math.min(1.8, sharp))
    src.connect(g).connect(out)
    src.start(when)
  }

  /** many impulse pops spread over time — crackling / popping stars */
  private crackleField(when: number, spread: number, grains: number, size: number, pan: number, distance = 300): void {
    const ctx = this.ctx
    if (!ctx) return
    this.ensureSamples()
    const out = this.voice(when, pan, 0.45, distance)
    if (!out) return
    const n = Math.min(80, Math.floor(grains))
    for (let i = 0; i < n; i++) {
      // pops come in uneven bursts, like real dragon-egg stars
      const t = when + spread * Math.pow(this.rng.next(), 0.7)
      const src = ctx.createBufferSource()
      src.buffer = this.clicks[Math.floor(this.rng.next() * this.clicks.length)]
      src.playbackRate.value = 0.7 + this.rng.next() * 0.8
      const g = ctx.createGain()
      g.gain.value = this.rng.range(0.15, 0.6) * size
      src.connect(g).connect(out)
      src.start(t)
    }
  }

  /** falling glitter / willow hiss: high noise with grainy amplitude */
  private sizzle(when: number, dur: number, level: number, pan: number, freq = 6500, distance = 300): void {
    const ctx = this.ctx
    if (!ctx) return
    const out = this.voice(when, pan, 0.4, distance)
    const src = this.noise(when, dur)
    if (!out || !src) return
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = freq * 0.5
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, when)
    g.gain.linearRampToValueAtTime(level, when + dur * 0.3)
    g.gain.linearRampToValueAtTime(level * 0.5, when + dur * 0.75)
    g.gain.linearRampToValueAtTime(0, when + dur)
    src.connect(hp).connect(g).connect(out)
  }

  // ------------------------------------------------------------ public

  /** mortar lift: muffled thump; some shells carry a whistle (noisy shriek) */
  playLaunch(cue: { fuse: number; whistle: boolean; pan: number; gain: number; delay: number }): void {
    if (!this.enabled || !this.ctx) return
    const ctx = this.ctx
    this.ensureSamples()
    const when = ctx.currentTime + cue.delay
    const distance = cue.delay * 690
    // the lift charge goes off inside a tube: low, dull, no crack
    const out = this.voice(when, cue.pan, 0.35, distance)
    if (!out) return
    const tube = ctx.createBiquadFilter()
    tube.type = 'lowpass'
    tube.frequency.value = 320
    tube.Q.value = 0.9
    const src = ctx.createBufferSource()
    src.buffer = this.bursts[1 + 3 * Math.floor(this.rng.next() * 3)]
    src.playbackRate.value = 0.85 + this.rng.next() * 0.2
    const g = ctx.createGain()
    g.gain.value = 0.8 * cue.gain
    src.connect(tube).connect(g).connect(out)
    src.start(when)

    if (cue.whistle) {
      // a real whistle is air resonating in a tube: narrow-band noise, not a tone
      const n = this.noise(when + 0.05, cue.fuse)
      if (!n) return
      const f0 = this.rng.range(1600, 2600)
      const bp1 = ctx.createBiquadFilter()
      bp1.type = 'bandpass'
      bp1.Q.value = 35
      bp1.frequency.setValueAtTime(f0 * 0.6, when)
      bp1.frequency.exponentialRampToValueAtTime(f0, when + 0.4)
      bp1.frequency.linearRampToValueAtTime(f0 * 1.08, when + cue.fuse)
      const bp2 = ctx.createBiquadFilter()
      bp2.type = 'bandpass'
      bp2.Q.value = 20
      bp2.frequency.setValueAtTime(f0 * 0.6, when)
      bp2.frequency.exponentialRampToValueAtTime(f0, when + 0.4)
      bp2.frequency.linearRampToValueAtTime(f0 * 1.08, when + cue.fuse)
      const wg = ctx.createGain()
      wg.gain.setValueAtTime(0, when)
      wg.gain.linearRampToValueAtTime(1.6 * cue.gain, when + 0.2)
      wg.gain.setValueAtTime(1.6 * cue.gain, when + cue.fuse * 0.8)
      wg.gain.linearRampToValueAtTime(0, when + cue.fuse)
      n.connect(bp1).connect(bp2).connect(wg).connect(out)
    } else {
      // burning lift trail: faint rising hiss
      this.sizzle(when + 0.05, cue.fuse * 0.8, 0.02 * cue.gain, cue.pan, 3000, distance)
    }
  }

  playBurst(cue: SoundCue): void {
    if (!this.enabled || !this.ctx) return
    const when = this.ctx.currentTime + cue.delay
    const size = Math.min(1.8, (0.45 + cue.size * 0.6) * cue.gain)
    const pan = cue.pan
    const dist = cue.delay * 690
    switch (cue.kind) {
      case 'salute':
        this.report(when, size * 1.5, 2.4, pan, dist, 0.8)
        break
      case 'crackle':
        this.report(when, size * 0.85, 1.1, pan, dist)
        this.crackleField(when + cue.duration * 0.55, cue.duration * 0.5, 50 * Math.min(1.3, cue.size), size, pan, dist)
        break
      case 'heavy':
        this.report(when, size * 1.15, 0.8, pan, dist, 0.8)
        this.sizzle(when + 0.2, cue.duration, 0.035 * size, pan, 7000, dist)
        this.crackleField(when + 0.4, cue.duration * 0.8, 16, size * 0.3, pan, dist)
        break
      case 'strobe':
        this.report(when, size * 0.75, 0.9, pan, dist)
        this.sizzle(when + 0.4, cue.duration * 0.8, 0.02 * size, pan, 8000, dist)
        break
      case 'soft':
        this.report(when, size * 0.65, 0.85, pan, dist)
        break
      case 'pop':
        this.report(when, size * 0.45, 1.3, pan, dist, 0.5)
        break
      default:
        this.report(when, size, 1, pan, dist)
    }
  }

  /** crackling stars dying (polled from the simulation) */
  playCrackle(amount: number): void {
    if (!this.enabled || !this.ctx) return
    this.crackleField(this.ctx.currentTime + 0.35, 0.2, 4 + amount * 24, 0.5 + amount * 0.5, this.rng.range(-0.4, 0.4))
  }

  /** crossette splits: dry, sharp small reports */
  playSplit(amount: number): void {
    if (!this.enabled || !this.ctx) return
    const when = this.ctx.currentTime + 0.35
    const n = 2 + Math.round(amount * 5)
    for (let i = 0; i < n; i++) {
      this.report(when + this.rng.range(0, 0.12), 0.25 + amount * 0.15, 2.2, this.rng.range(-0.5, 0.5), 300, 0.4)
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
    this.bursts = []
    this.clicks = []
  }
}

function normalize(d: Float32Array, peak: number): void {
  let m = 0
  for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]))
  if (m > 0) {
    const k = peak / m
    for (let i = 0; i < d.length; i++) d[i] *= k
  }
}
