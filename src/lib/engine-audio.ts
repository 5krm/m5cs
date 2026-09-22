/**
 * Synthetic Twin-Turbo 4.4L V8 Engine Sound Simulator
 * Pure Web Audio API — zero network downloads, zero latency.
 */

class V8EngineAudio {
  private ctx: AudioContext | null = null
  private isRunning = false
  private masterGain: GainNode | null = null
  private oscSub: OscillatorNode | null = null
  private oscMain: OscillatorNode | null = null
  private oscHarmonic: OscillatorNode | null = null
  private filter: BiquadFilterNode | null = null
  private turboFilter: BiquadFilterNode | null = null
  private turboGain: GainNode | null = null
  private noiseSource: AudioBufferSourceNode | null = null
  private currentRpm = 800 // 800 idle -> 7200 max

  private initContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      this.ctx = new AudioCtx()
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume()
    }
  }

  public get running() {
    return this.isRunning
  }

  /**
   * Live engine speed derived from the sub oscillator's automated frequency
   * (42 Hz ≈ 800 rpm idle → 190 Hz ≈ 3 600 rpm… scaled so a full rev reads
   * as ~6 800 rpm on the cockpit tachometer). 0 when the engine is off.
   */
  public get rpm(): number {
    if (!this.isRunning || !this.oscSub) return 0
    const f = this.oscSub.frequency.value
    const norm = (f - 42) / (190 - 42) // 0 idle → 1 peak
    return Math.max(0, Math.min(7200, 800 + norm * 6000))
  }

  public start() {
    this.initContext()
    if (!this.ctx || this.isRunning) return

    const now = this.ctx.currentTime

    // Master Volume
    this.masterGain = this.ctx.createGain()
    this.masterGain.gain.setValueAtTime(0, now)
    this.masterGain.gain.linearRampToValueAtTime(0.35, now + 0.3)
    this.masterGain.connect(this.ctx.destination)

    // Main Lowpass Tone Filter
    this.filter = this.ctx.createBiquadFilter()
    this.filter.type = 'lowpass'
    this.filter.frequency.setValueAtTime(320, now)
    this.filter.Q.setValueAtTime(4, now)
    this.filter.connect(this.masterGain)

    // Sub-bass cylinder thumping (Triangle)
    this.oscSub = this.ctx.createOscillator()
    this.oscSub.type = 'triangle'
    this.oscSub.frequency.setValueAtTime(42, now) // ~800 RPM
    this.oscSub.connect(this.filter)
    this.oscSub.start(now)

    // Main V8 crossplane pulse (Sawtooth)
    this.oscMain = this.ctx.createOscillator()
    this.oscMain.type = 'sawtooth'
    this.oscMain.frequency.setValueAtTime(84, now)
    const mainGain = this.ctx.createGain()
    mainGain.gain.setValueAtTime(0.5, now)
    this.oscMain.connect(mainGain)
    mainGain.connect(this.filter)
    this.oscMain.start(now)

    // Secondary harmonic (high rev growl)
    this.oscHarmonic = this.ctx.createOscillator()
    this.oscHarmonic.type = 'sawtooth'
    this.oscHarmonic.frequency.setValueAtTime(126, now)
    const harmGain = this.ctx.createGain()
    harmGain.gain.setValueAtTime(0.25, now)
    this.oscHarmonic.connect(harmGain)
    harmGain.connect(this.filter)
    this.oscHarmonic.start(now)

    // Turbocharger spool noise buffer (continuous looping noise)
    const bufferSize = this.ctx.sampleRate * 2
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate)
    const output = noiseBuffer.getChannelData(0)
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1
    }

    this.noiseSource = this.ctx.createBufferSource()
    this.noiseSource.buffer = noiseBuffer
    this.noiseSource.loop = true

    this.turboFilter = this.ctx.createBiquadFilter()
    this.turboFilter.type = 'bandpass'
    this.turboFilter.frequency.setValueAtTime(1400, now)
    this.turboFilter.Q.setValueAtTime(6, now)

    this.turboGain = this.ctx.createGain()
    this.turboGain.gain.setValueAtTime(0.04, now)

    this.noiseSource.connect(this.turboFilter)
    this.turboFilter.connect(this.turboGain)
    this.turboGain.connect(this.masterGain)
    this.noiseSource.start(now)

    this.isRunning = true
  }

  public rev() {
    if (!this.isRunning || !this.ctx || !this.oscSub || !this.oscMain || !this.oscHarmonic || !this.filter || !this.turboFilter || !this.turboGain) {
      this.start()
    }
    if (!this.ctx || !this.oscSub || !this.oscMain || !this.oscHarmonic || !this.filter || !this.turboFilter || !this.turboGain) return

    const now = this.ctx.currentTime

    // Rev up to 6,800 RPM in 0.5s
    const targetFreqSub = 190
    const targetFreqMain = 380
    const targetFreqHarm = 570
    const targetFilterCutoff = 2200

    this.oscSub.frequency.cancelScheduledValues(now)
    this.oscMain.frequency.cancelScheduledValues(now)
    this.oscHarmonic.frequency.cancelScheduledValues(now)
    this.filter.frequency.cancelScheduledValues(now)
    this.turboFilter.frequency.cancelScheduledValues(now)
    this.turboGain.gain.cancelScheduledValues(now)

    // Accelerate
    this.oscSub.frequency.exponentialRampToValueAtTime(targetFreqSub, now + 0.45)
    this.oscMain.frequency.exponentialRampToValueAtTime(targetFreqMain, now + 0.45)
    this.oscHarmonic.frequency.exponentialRampToValueAtTime(targetFreqHarm, now + 0.45)
    this.filter.frequency.exponentialRampToValueAtTime(targetFilterCutoff, now + 0.45)

    // Turbo spool
    this.turboFilter.frequency.exponentialRampToValueAtTime(3800, now + 0.45)
    this.turboGain.gain.linearRampToValueAtTime(0.22, now + 0.45)

    // Peak hold brief instant
    const peakTime = now + 0.55

    // Throttle drop & exhaust burble return to idle
    const returnTime = peakTime + 0.8
    this.oscSub.frequency.exponentialRampToValueAtTime(42, returnTime)
    this.oscMain.frequency.exponentialRampToValueAtTime(84, returnTime)
    this.oscHarmonic.frequency.exponentialRampToValueAtTime(126, returnTime)
    this.filter.frequency.exponentialRampToValueAtTime(320, returnTime)

    // Turbo blow-off valve hiss / pressure release
    this.turboFilter.frequency.setValueAtTime(4500, peakTime)
    this.turboGain.gain.setValueAtTime(0.3, peakTime)
    this.turboGain.gain.exponentialRampToValueAtTime(0.04, returnTime)
  }

  public stop() {
    if (!this.isRunning || !this.ctx || !this.masterGain) return
    const now = this.ctx.currentTime
    this.masterGain.gain.linearRampToValueAtTime(0, now + 0.25)
    setTimeout(() => {
      try {
        this.oscSub?.stop()
        this.oscMain?.stop()
        this.oscHarmonic?.stop()
        this.noiseSource?.stop()
      } catch {
        // ignore already stopped
      }
      this.isRunning = false
    }, 280)
  }
}

export const v8Audio = new V8EngineAudio()
