/**
 * BMW M5 CS (F90) 4.4-Liter Twin-Turbo V8 Audio Engine
 * High-fidelity authentic automotive acoustics:
 * - Real dual-mode architecture: Master authentic audio track + responsive Web Audio procedural synthesis
 * - Cold start ignition flare, cross-plane 8-cylinder idle pulse, twin-turbo spool, and aggressive overrun crackles
 * - Instant on-demand throttle rev blips with exhaust gunshot pops
 */

class V8AudioEngine {
  private audioEl: HTMLAudioElement | null = null
  private revEl: HTMLAudioElement | null = null
  private idleEl: HTMLAudioElement | null = null
  private fadeInterval: number | null = null
  private listeners: Set<(active: boolean) => void> = new Set()

  // Web Audio procedural synthesis fallback
  private ctx: AudioContext | null = null
  private isRunning = false
  private masterGain: GainNode | null = null
  private cylOsc1: OscillatorNode | null = null
  private cylOsc2: OscillatorNode | null = null
  private subOsc: OscillatorNode | null = null
  private turboOsc: OscillatorNode | null = null
  private turboGain: GainNode | null = null
  private exhaustFilter: BiquadFilterNode | null = null
  private bodyFilter: BiquadFilterNode | null = null
  private animFrameId: number | null = null
  private currentRpm = 850
  private targetRpm = 850

  public isStarted = false

  public subscribe(cb: (active: boolean) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private notify(active: boolean) {
    this.isStarted = active
    this.listeners.forEach((cb) => cb(active))
  }

  private initElements() {
    if (typeof window === 'undefined') return
    if (!this.audioEl) {
      this.audioEl = new Audio('/audio/bmw_m5_cs_v8.mp3')
      this.audioEl.preload = 'auto'
      this.audioEl.volume = 0.85

      // When the 23-second initial ignition & showcase ends, transition into continuous idle
      this.audioEl.addEventListener('ended', () => {
        if (this.isStarted && this.idleEl) {
          this.idleEl.currentTime = 0
          this.idleEl.play().catch(() => {})
        }
      })
    }

    if (!this.idleEl) {
      this.idleEl = new Audio('/audio/bmw_m5_idle.mp3')
      this.idleEl.preload = 'auto'
      this.idleEl.loop = true
      this.idleEl.volume = 0.75
    }

    if (!this.revEl) {
      this.revEl = new Audio('/audio/bmw_m5_rev.mp3')
      this.revEl.preload = 'auto'
      this.revEl.volume = 0.95
    }
  }

  public async startEngine(): Promise<boolean> {
    if (typeof window === 'undefined') return false
    this.initElements()

    if (this.fadeInterval) {
      window.clearInterval(this.fadeInterval)
      this.fadeInterval = null
    }

    try {
      if (this.audioEl) {
        this.audioEl.currentTime = 0
        this.audioEl.volume = 0.85
        await this.audioEl.play()
        this.notify(true)
        return true
      }
    } catch {
      // Browser autoplay policy or media error — fail over to Web Audio synthesis
    }

    // Fallback: Web Audio synth
    const synthOk = await this.startSynthEngine()
    if (synthOk) {
      this.notify(true)
      return true
    }

    return false
  }

  public stopEngine() {
    this.notify(false)

    // Smooth fade out
    if (this.audioEl && !this.audioEl.paused) {
      let vol = this.audioEl.volume
      const step = 0.1
      const interval = window.setInterval(() => {
        vol -= step
        if (vol <= 0.05) {
          window.clearInterval(interval)
          if (this.audioEl) {
            this.audioEl.pause()
            this.audioEl.currentTime = 0
            this.audioEl.volume = 0.85
          }
        } else if (this.audioEl) {
          this.audioEl.volume = Math.max(0, vol)
        }
      }, 40)
    }

    if (this.idleEl && !this.idleEl.paused) {
      this.idleEl.pause()
      this.idleEl.currentTime = 0
    }

    if (this.revEl && !this.revEl.paused) {
      this.revEl.pause()
      this.revEl.currentTime = 0
    }

    this.stopSynthEngine()
  }

  /** Trigger an aggressive throttle rev blip with overrun pops */
  public rev() {
    if (!this.isStarted) {
      this.startEngine().then(() => {
        this.playRevClip()
      })
      return
    }

    this.playRevClip()
    this.revTo(6500)
    setTimeout(() => this.releaseThrottle(), 800)
  }

  private playRevClip() {
    if (this.revEl) {
      try {
        this.revEl.currentTime = 0
        this.revEl.volume = 0.95
        this.revEl.play().catch(() => {})
      } catch {
        // ignore
      }
    }
  }

  /* ════════ Web Audio Synthesis Fallback ════════ */
  private initSynthContext() {
    if (this.ctx) return
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    this.ctx = new AudioCtx()
  }

  private async startSynthEngine(): Promise<boolean> {
    this.initSynthContext()
    if (!this.ctx) return false

    if (this.ctx.state === 'suspended') {
      await this.ctx.resume()
    }

    if (this.isRunning) return true

    const now = this.ctx.currentTime
    this.masterGain = this.ctx.createGain()
    this.masterGain.gain.setValueAtTime(0.0001, now)
    this.masterGain.gain.exponentialRampToValueAtTime(0.3, now + 0.4)
    this.masterGain.connect(this.ctx.destination)

    this.cylOsc1 = this.ctx.createOscillator()
    this.cylOsc1.type = 'sawtooth'

    this.cylOsc2 = this.ctx.createOscillator()
    this.cylOsc2.type = 'triangle'

    this.subOsc = this.ctx.createOscillator()
    this.subOsc.type = 'sine'

    this.turboOsc = this.ctx.createOscillator()
    this.turboOsc.type = 'sine'
    this.turboGain = this.ctx.createGain()
    this.turboGain.gain.setValueAtTime(0.008, now)
    this.turboOsc.connect(this.turboGain)
    this.turboGain.connect(this.masterGain)

    this.exhaustFilter = this.ctx.createBiquadFilter()
    this.exhaustFilter.type = 'bandpass'
    this.exhaustFilter.Q.value = 3.2

    this.bodyFilter = this.ctx.createBiquadFilter()
    this.bodyFilter.type = 'lowpass'
    this.bodyFilter.frequency.value = 480

    this.cylOsc1.connect(this.exhaustFilter)
    this.cylOsc2.connect(this.bodyFilter)
    this.subOsc.connect(this.masterGain)
    this.exhaustFilter.connect(this.masterGain)
    this.bodyFilter.connect(this.masterGain)

    const baseFreq = (850 / 60) * 2
    this.cylOsc1.frequency.setValueAtTime(baseFreq, now)
    this.cylOsc2.frequency.setValueAtTime(baseFreq * 2, now)
    this.subOsc.frequency.setValueAtTime(baseFreq * 0.5, now)
    this.turboOsc.frequency.setValueAtTime(1400, now)
    this.exhaustFilter.frequency.setValueAtTime(180, now)

    this.cylOsc1.start(now)
    this.cylOsc2.start(now)
    this.subOsc.start(now)
    this.turboOsc.start(now)

    this.isRunning = true
    this.startSynthLoop()
    return true
  }

  private stopSynthEngine() {
    if (!this.isRunning || !this.ctx || !this.masterGain) return
    const now = this.ctx.currentTime
    this.masterGain.gain.linearRampToValueAtTime(0.0001, now + 0.3)
    setTimeout(() => {
      try {
        this.cylOsc1?.stop()
        this.cylOsc2?.stop()
        this.subOsc?.stop()
        this.turboOsc?.stop()
        this.cylOsc1?.disconnect()
        this.cylOsc2?.disconnect()
        this.subOsc?.disconnect()
        this.turboOsc?.disconnect()
      } catch {
        // ignore
      }
      this.isRunning = false
      if (this.animFrameId) cancelAnimationFrame(this.animFrameId)
    }, 350)
  }

  public revTo(rpm: number) {
    this.targetRpm = Math.max(800, Math.min(7200, rpm))
  }

  public releaseThrottle() {
    this.targetRpm = 850
    if (this.currentRpm > 3200 && this.ctx && this.masterGain) {
      this.triggerSynthPop()
    }
  }

  private triggerSynthPop() {
    if (!this.ctx || !this.masterGain) return
    const now = this.ctx.currentTime
    const numPops = 2 + Math.floor(Math.random() * 3)
    for (let i = 0; i < numPops; i++) {
      const popTime = now + 0.08 + i * 0.09
      const bufferSize = this.ctx.sampleRate * 0.035
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate)
      const data = buffer.getChannelData(0)
      for (let j = 0; j < bufferSize; j++) {
        data[j] = (Math.random() * 2 - 1) * Math.exp(-j / (bufferSize * 0.25))
      }
      const noise = this.ctx.createBufferSource()
      noise.buffer = buffer
      const filter = this.ctx.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = 650
      const gain = this.ctx.createGain()
      gain.gain.setValueAtTime(0.18, popTime)
      gain.gain.linearRampToValueAtTime(0.001, popTime + 0.04)
      noise.connect(filter)
      filter.connect(gain)
      gain.connect(this.masterGain)
      noise.start(popTime)
      noise.stop(popTime + 0.05)
    }
  }

  private startSynthLoop() {
    const loop = () => {
      if (!this.isRunning) return
      const rate = this.targetRpm > this.currentRpm ? 0.12 : 0.045
      this.currentRpm += (this.targetRpm - this.currentRpm) * rate
      if (this.ctx && this.cylOsc1 && this.cylOsc2 && this.subOsc && this.turboOsc && this.exhaustFilter && this.turboGain) {
        const now = this.ctx.currentTime
        const firingFreq = (this.currentRpm / 60) * 2
        this.cylOsc1.frequency.setTargetAtTime(firingFreq, now, 0.02)
        this.cylOsc2.frequency.setTargetAtTime(firingFreq * 1.5, now, 0.02)
        this.subOsc.frequency.setTargetAtTime(firingFreq * 0.5, now, 0.02)
        this.exhaustFilter.frequency.setTargetAtTime(160 + (this.currentRpm / 7200) * 580, now, 0.03)
        const turboFactor = Math.max(0, (this.currentRpm - 1800) / 5400)
        this.turboOsc.frequency.setTargetAtTime(1400 + turboFactor * 4200, now, 0.04)
        this.turboGain.gain.setTargetAtTime(0.004 + turboFactor * 0.035, now, 0.03)
      }
      this.animFrameId = requestAnimationFrame(loop)
    }
    this.animFrameId = requestAnimationFrame(loop)
  }
}

export const v8Audio = new V8AudioEngine()
