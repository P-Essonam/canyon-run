// The screen's sound, made with Web Audio (no files): an engine roar that
// rises with speed, a whoosh when a rocket brushes a wall, an explosion
// and countdown beeps. Muted until someone turns it on; browsers only
// allow sound after a click anyway.

export class Sound {
  private context: AudioContext | null = null
  private master: GainNode | null = null
  private engine: GainNode | null = null
  private engineFilter: BiquadFilterNode | null = null
  private muted = true
  private volume = 0.7

  get isMuted() {
    return this.muted
  }

  async setMuted(muted: boolean) {
    this.muted = muted
    if (!muted) {
      this.build()
      await this.context?.resume().catch(() => {})
    }
    this.applyVolume()
  }

  get level() {
    return this.volume
  }

  // 0..1. Moving the slider also unmutes.
  async setVolume(volume: number) {
    this.volume = Math.max(0, Math.min(1, volume))
    if (this.muted && this.volume > 0) {
      await this.setMuted(false)
      return
    }
    this.applyVolume()
  }

  private applyVolume() {
    if (!this.master || !this.context) return
    // Squared, so the slider feels even; up to 1.8x for a loud room.
    const gain = this.muted ? 0 : this.volume * this.volume * 1.8
    this.master.gain.setTargetAtTime(gain, this.context.currentTime, 0.05)
  }

  // 0 = silent, 1 = full roar.
  setEngine(level: number) {
    if (!this.context || !this.engine || !this.engineFilter) return
    const now = this.context.currentTime
    this.engine.gain.setTargetAtTime(level * 0.6, now, 0.1)
    this.engineFilter.frequency.setTargetAtTime(300 + level * 1400, now, 0.1)
  }

  whoosh() {
    const context = this.ready()
    if (!context || !this.master) return
    const now = context.currentTime
    const source = this.noise(0.5)
    const filter = context.createBiquadFilter()
    filter.type = "bandpass"
    filter.frequency.setValueAtTime(600, now)
    filter.frequency.exponentialRampToValueAtTime(2400, now + 0.25)
    const gain = context.createGain()
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.45, now + 0.05)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.45)
    source.connect(filter).connect(gain).connect(this.master)
    source.start(now)
    source.stop(now + 0.5)
  }

  explosion() {
    const context = this.ready()
    if (!context || !this.master) return
    const now = context.currentTime
    const source = this.noise(2)
    const filter = context.createBiquadFilter()
    filter.type = "lowpass"
    filter.frequency.setValueAtTime(5000, now)
    filter.frequency.exponentialRampToValueAtTime(120, now + 1.4)
    const gain = context.createGain()
    gain.gain.setValueAtTime(1, now)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.8)
    source.connect(filter).connect(gain).connect(this.master)
    source.start(now)
    source.stop(now + 2)

    const thump = context.createOscillator()
    thump.frequency.setValueAtTime(120, now)
    thump.frequency.exponentialRampToValueAtTime(30, now + 0.6)
    const thumpGain = context.createGain()
    thumpGain.gain.setValueAtTime(0.9, now)
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.8)
    thump.connect(thumpGain).connect(this.master)
    thump.start(now)
    thump.stop(now + 0.9)
  }

  beep(high = false) {
    const context = this.ready()
    if (!context || !this.master) return
    const now = context.currentTime
    const osc = context.createOscillator()
    osc.type = "square"
    osc.frequency.value = high ? 880 : 440
    const gain = context.createGain()
    gain.gain.setValueAtTime(0.2, now)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + (high ? 0.5 : 0.2))
    osc.connect(gain).connect(this.master)
    osc.start(now)
    osc.stop(now + 0.6)
  }

  dispose() {
    void this.context?.close()
    this.context = null
  }

  private ready() {
    return this.muted ? null : this.context
  }

  private build() {
    if (this.context) return
    const context = new AudioContext()
    this.context = context
    this.master = context.createGain()
    this.master.gain.value = 0
    // A compressor keeps the louder mix from clipping.
    const limiter = context.createDynamicsCompressor()
    limiter.threshold.value = -10
    limiter.ratio.value = 8
    this.master.connect(limiter).connect(context.destination)

    // The engine: looping brown noise through a lowpass that opens up
    // with speed.
    const source = this.noise(2, true)
    source.loop = true
    this.engineFilter = context.createBiquadFilter()
    this.engineFilter.type = "lowpass"
    this.engineFilter.frequency.value = 300
    this.engine = context.createGain()
    this.engine.gain.value = 0
    source.connect(this.engineFilter).connect(this.engine).connect(this.master)
    source.start()
  }

  private noise(seconds: number, brown = false) {
    const context = this.context!
    const length = Math.floor(context.sampleRate * seconds)
    const buffer = context.createBuffer(1, length, context.sampleRate)
    const data = buffer.getChannelData(0)
    let last = 0
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1
      if (brown) {
        last = (last + 0.02 * white) / 1.02
        data[i] = last * 3.5
      } else {
        data[i] = white
      }
    }
    const source = context.createBufferSource()
    source.buffer = buffer
    return source
  }
}
