// ui.js — start screen, HUD (čas + rekord), win overlay, localStorage rekord.
const BEST_KEY = '1p-island-run-best-ms'

export function formatTime(ms) {
  const totalS = ms / 1000
  const m = Math.floor(totalS / 60)
  const s = totalS - m * 60
  return `${m}:${s.toFixed(2).padStart(5, '0')}`
}

export class UI {
  constructor({ isTouch, onStart, onReplay, onResume }) {
    this.startScreen = document.getElementById('start-screen')
    this.winOverlay = document.getElementById('win-overlay')
    this.resumeOverlay = document.getElementById('resume-overlay')
    this.hud = document.getElementById('hud')
    this.hudTime = document.getElementById('hud-time')
    this.hudBest = document.getElementById('hud-best')
    this.finalTime = document.getElementById('final-time')
    this.recordBadge = document.getElementById('record-badge')
    this.winBest = document.getElementById('win-best')
    this.startBest = document.getElementById('start-best')

    if (isTouch) {
      document.getElementById('instructions-desktop').style.display = 'none'
      document.getElementById('instructions-mobile').style.display = 'block'
    }

    document.getElementById('start-btn').addEventListener('click', onStart)
    document.getElementById('replay-btn').addEventListener('click', onReplay)
    document.getElementById('resume-btn').addEventListener('click', onResume)

    this._refreshBestLabels()
  }

  get best() {
    const v = localStorage.getItem(BEST_KEY)
    return v ? parseInt(v, 10) : null
  }

  _refreshBestLabels() {
    const b = this.best
    this.hudBest.textContent = b ? formatTime(b) : '—'
    this.startBest.textContent = b ? `Tvůj rekord: ${formatTime(b)}` : ''
  }

  showStart() {
    this.startScreen.classList.remove('hidden')
    this.winOverlay.classList.add('hidden')
    this.resumeOverlay.classList.add('hidden')
    this.hud.classList.remove('visible')
    this._refreshBestLabels()
  }

  showPlaying(isTouch) {
    this.startScreen.classList.add('hidden')
    this.winOverlay.classList.add('hidden')
    this.resumeOverlay.classList.add('hidden')
    this.hud.classList.add('visible')
    document.getElementById('touch-ui').classList.toggle('visible', isTouch)
    this._refreshBestLabels()
  }

  updateTimer(ms) {
    const totalS = ms / 1000
    const m = Math.floor(totalS / 60)
    const s = totalS - m * 60
    this.hudTime.textContent = `${m}:${s.toFixed(1).padStart(4, '0')}`
  }

  /** @returns true pokud jde o nový rekord */
  showWin(ms) {
    const prevBest = this.best
    const isRecord = !prevBest || ms < prevBest
    if (isRecord) localStorage.setItem(BEST_KEY, String(Math.round(ms)))

    this.finalTime.textContent = formatTime(ms)
    this.recordBadge.classList.toggle('show', isRecord)
    const b = this.best
    this.winBest.textContent = b ? `Nejlepší čas: ${formatTime(b)}` : ''
    this.winOverlay.classList.remove('hidden')
    this.hud.classList.remove('visible')
    document.getElementById('touch-ui').classList.remove('visible')
    return isRecord
  }

  showResume() {
    this.resumeOverlay.classList.remove('hidden')
  }

  hideResume() {
    this.resumeOverlay.classList.add('hidden')
  }
}
