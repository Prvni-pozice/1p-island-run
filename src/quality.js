// quality.js — adaptivní kvalita: při poklesu FPS ubírá (pixel ratio, bloom,
// SMAA), při stabilně vysokém FPS zase přidává. Hystereze + cooldown, aby
// nepřepínala tam a zpět.
export class QualityManager {
  constructor({ renderer, composer, bloom, smaa, isTouch }) {
    this.renderer = renderer
    this.composer = composer
    this.bloom = bloom
    this.smaa = smaa

    // od nejnižší po nejvyšší
    this.levels = [
      { ratio: 1.0, bloom: false, smaa: false },
      { ratio: 1.25, bloom: false, smaa: true },
      { ratio: 1.5, bloom: true, smaa: true },
      { ratio: 2.0, bloom: true, smaa: true },
    ]
    this.level = isTouch ? 2 : 3
    this.ema = 60
    this.warmup = 3       // prvních pár sekund neměřit (načítání, shader compile)
    this.cooldown = 0
    this.lowT = 0
    this.highT = 0
    this.apply()
  }

  /** @param rawDt neclampnutá delta (s) */
  update(rawDt) {
    if (rawDt <= 0) return
    if (this.warmup > 0) { this.warmup -= rawDt; return }

    const fps = 1 / rawDt
    this.ema += (fps - this.ema) * Math.min(1, rawDt * 2)

    if (this.cooldown > 0) { this.cooldown -= rawDt; return }

    if (this.ema < 27) { this.lowT += rawDt; this.highT = 0 }
    else if (this.ema > 55) { this.highT += rawDt; this.lowT = 0 }
    else { this.lowT = 0; this.highT = 0 }

    if (this.lowT > 1.5 && this.level > 0) {
      this.level--
      this.apply()
      this.cooldown = 4
      this.lowT = 0
    } else if (this.highT > 8 && this.level < this.levels.length - 1) {
      this.level++
      this.apply()
      this.cooldown = 6 // po zvýšení chvíli sledovat, případný pokles vrátí zpět
      this.highT = 0
    }
  }

  apply() {
    const L = this.levels[this.level]
    const r = Math.min(window.devicePixelRatio || 1, L.ratio)
    this.renderer.setPixelRatio(r)
    this.composer.setPixelRatio(r)
    const w = window.innerWidth, h = window.innerHeight
    this.renderer.setSize(w, h)
    this.composer.setSize(w, h)
    this.bloom.enabled = L.bloom
    this.smaa.enabled = L.smaa
    console.info(`[kvalita] úroveň ${this.level}: ratio ${r.toFixed(2)}, bloom ${L.bloom}, smaa ${L.smaa}`)
  }
}
