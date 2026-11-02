import { Rng } from './rng'

interface MusicAnalyserState {
  analyser: AnalyserNode
  freqData: Uint8Array<ArrayBuffer>
  source: MediaElementAudioSourceNode
}

export class SoundEngine {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private noiseBuffer: AudioBuffer | null = null
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

  private boom(when: number, size: number): void {
    const ctx = this.ctx
    if (!ctx || !this.master || !this.noiseBuffer) return

    const low = ctx.createOscillator()
    low.type = 'sine'
    low.frequency.setValueAtTime(96 * size, when)
    low.frequency.exponentialRampToValueAtTime(24, when + 0.55)
    const lowGain = ctx.createGain()
    lowGain.gain.setValueAtTime(0, when)
    lowGain.gain.linearRampToValueAtTime(0.85 * size, when + 0.012)
    lowGain.gain.exponentialRampToValueAtTime(0.0006, when + 1.5)
    low.connect(lowGain).connect(this.master)
    low.start(when)
    low.stop(when + 1.6)

    const noise = ctx.createBufferSource()
    noise.buffer = this.noiseBuffer
    const bp = ctx.createBiquadFilter()
    bp.type = 'lowpass'
    bp.frequency.setValueAtTime(1600 * size, when)
    bp.frequency.exponentialRampToValueAtTime(180, when + 0.7)
    const nGain = ctx.createGain()
    nGain.gain.setValueAtTime(0, when)
    nGain.gain.linearRampToValueAtTime(0.6 * size, when + 0.01)
    nGain.gain.exponentialRampToValueAtTime(0.0004, when + 0.9)
    noise.connect(bp).connect(nGain).connect(this.master)
    noise.start(when)
    noise.stop(when + 1)
  }

  private crackle(when: number, size: number): void {
    const ctx = this.ctx
    if (!ctx || !this.master || !this.noiseBuffer) return
    const grains = Math.floor(16 * size)
    for (let i = 0; i < grains; i++) {
      const t = when + this.rng.range(0, 1.1)
      const src = ctx.createBufferSource()
      src.buffer = this.noiseBuffer
      const hp = ctx.createBiquadFilter()
      hp.type = 'highpass'
      hp.frequency.value = this.rng.range(2400, 6200)
      const g = ctx.createGain()
      const amp = this.rng.range(0.05, 0.22) * size
      g.gain.setValueAtTime(0, t)
      g.gain.linearRampToValueAtTime(amp, t + 0.002)
      g.gain.exponentialRampToValueAtTime(0.0002, t + this.rng.range(0.02, 0.09))
      src.connect(hp).connect(g).connect(this.master)
      src.start(t, this.rng.range(0, 1.5), 0.12)
    }
  }

  private whistle(when: number, duration: number, pitch: number): void {
    const ctx = this.ctx
    if (!ctx || !this.master) return
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(pitch * 0.6, when)
    osc.frequency.exponentialRampToValueAtTime(pitch * 1.5, when + duration)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, when)
    g.gain.linearRampToValueAtTime(0.045, when + 0.08)
    g.gain.exponentialRampToValueAtTime(0.0004, when + duration)
    osc.connect(g).connect(this.master)
    osc.start(when)
    osc.stop(when + duration + 0.05)
  }

  playLaunch(duration: number): void {
    if (!this.enabled || !this.ctx) return
    this.whistle(this.ctx.currentTime, duration, this.rng.range(620, 980))
  }

  playBurst(size: number): void {
    if (!this.enabled || !this.ctx) return
    const when = this.ctx.currentTime
    this.boom(when, Math.min(1.4, 0.7 + size / 700))
    this.crackle(when + 0.04, Math.min(1.2, 0.5 + size / 900))
  }

  playLaunchAndBurst(fuse: number, size: number): void {
    if (!this.enabled || !this.ctx) return
    const when = this.ctx.currentTime
    this.whistle(when, Math.max(0.4, fuse * 0.95), this.rng.range(620, 980))
    this.boom(when + fuse, Math.min(1.4, 0.7 + size / 700))
    this.crackle(when + fuse + 0.05, Math.min(1.2, 0.5 + size / 900))
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
  }
}
