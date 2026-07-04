// audio.js — zvuky generované WebAudio (žádné externí soubory):
// kroky, skok, šplouchnutí, pípnutí zvířete, fanfára v cíli.
// AudioContext se vytváří až na user gesture (iOS požadavek).
const MUTE_KEY = '1p-island-run-muted'

export class AudioFX {
  constructor() {
    this.ctx = null
    this.muted = localStorage.getItem(MUTE_KEY) === '1'
  }

  /** Volat z user gesture (klik na Start) */
  init() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext
      if (!AC) return
      this.ctx = new AC()
      this.master = this.ctx.createGain()
      this.master.gain.value = this.muted ? 0 : 0.25
      this.master.connect(this.ctx.destination)

      // sdílený noise buffer (1 s bílého šumu)
      const len = this.ctx.sampleRate
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
      const data = this.noiseBuf.getChannelData(0)
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
    }
    if (this.ctx.state === 'suspended') this.ctx.resume()
  }

  toggleMute() {
    this.muted = !this.muted
    localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0')
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.25
    return this.muted
  }

  _ready() { return this.ctx && this.ctx.state === 'running' && !this.muted }

  _noise({ dur, filterType, f0, f1, gain }) {
    const t = this.ctx.currentTime
    const src = this.ctx.createBufferSource()
    src.buffer = this.noiseBuf
    src.loop = true
    const filter = this.ctx.createBiquadFilter()
    filter.type = filterType
    filter.frequency.setValueAtTime(f0, t)
    if (f1 !== undefined) filter.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur)
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(gain, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + dur)
    src.connect(filter).connect(g).connect(this.master)
    src.start(t)
    src.stop(t + dur + 0.02)
  }

  _tone({ dur, type = 'triangle', f0, f1, gain, delay = 0 }) {
    const t = this.ctx.currentTime + delay
    const osc = this.ctx.createOscillator()
    osc.type = type
    osc.frequency.setValueAtTime(f0, t)
    if (f1 !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur)
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(gain, t + 0.015)
    g.gain.exponentialRampToValueAtTime(0.001, t + dur)
    osc.connect(g).connect(this.master)
    osc.start(t)
    osc.stop(t + dur + 0.02)
  }

  step() {
    if (!this._ready()) return
    this._noise({ dur: 0.07, filterType: 'bandpass', f0: 380 + Math.random() * 250, gain: 0.35 })
  }

  jump() {
    if (!this._ready()) return
    this._tone({ dur: 0.16, type: 'sine', f0: 280, f1: 520, gain: 0.18 })
  }

  splash() {
    if (!this._ready()) return
    this._noise({ dur: 0.4, filterType: 'lowpass', f0: 1400, f1: 260, gain: 0.7 })
  }

  squeak() {
    if (!this._ready()) return
    const f = 750 + Math.random() * 700
    this._tone({ dur: 0.09, type: 'triangle', f0: f, f1: f * 1.5, gain: 0.22 })
    this._tone({ dur: 0.08, type: 'triangle', f0: f * 1.3, f1: f * 0.9, gain: 0.14, delay: 0.09 })
  }

  fanfare() {
    if (!this._ready()) return
    const notes = [523.25, 659.25, 783.99, 1046.5] // C5 E5 G5 C6
    notes.forEach((f, i) => {
      this._tone({ dur: 0.34, type: 'triangle', f0: f, gain: 0.3, delay: i * 0.13 })
      this._tone({ dur: 0.34, type: 'sine', f0: f * 2, gain: 0.08, delay: i * 0.13 })
    })
    this._tone({ dur: 0.9, type: 'triangle', f0: 1046.5, gain: 0.22, delay: notes.length * 0.13 })
  }
}
