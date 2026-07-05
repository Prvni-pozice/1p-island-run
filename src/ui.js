// ui.js — start screen, HUD (čas + rekord), win overlay, žebříček,
// localStorage rekord. Jména hráčů se vykreslují výhradně přes textContent.
import { fetchBoard, submitScore, requestSession, getSavedName, saveName } from './leaderboard.js'

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
    this.boardOverlay = document.getElementById('board-overlay')
    this.hud = document.getElementById('hud')
    this.hudTime = document.getElementById('hud-time')
    this.hudBest = document.getElementById('hud-best')
    this.finalTime = document.getElementById('final-time')
    this.recordBadge = document.getElementById('record-badge')
    this.winBest = document.getElementById('win-best')
    this.startBest = document.getElementById('start-best')
    this.startTop3 = document.getElementById('start-top3')
    this.winBoard = document.getElementById('win-board')
    this.saveScoreBox = document.getElementById('save-score')
    this.nameInput = document.getElementById('player-name')
    this.lastBoard = null
    this.lastRunMs = null
    this.runToken = null

    if (isTouch) {
      document.getElementById('instructions-desktop').style.display = 'none'
      document.getElementById('instructions-mobile').style.display = 'block'
    }

    document.getElementById('start-btn').addEventListener('click', onStart)
    document.getElementById('replay-btn').addEventListener('click', onReplay)
    document.getElementById('resume-btn').addEventListener('click', onResume)
    document.getElementById('board-link').addEventListener('click', () => this.showBoard())
    document.getElementById('board-close').addEventListener('click', () => {
      this.boardOverlay.classList.add('hidden')
    })
    document.getElementById('save-score-btn').addEventListener('click', () => this._submit())
    this.nameInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') this._submit()
      e.stopPropagation() // ať psaní jména neovládá hru
    })
    this.nameInput.value = getSavedName()

    this._refreshBestLabels()
    this.refreshBoards()
  }

  // ── lokální rekord ──
  get best() {
    const v = localStorage.getItem(BEST_KEY)
    return v ? parseInt(v, 10) : null
  }

  _refreshBestLabels() {
    const b = this.best
    this.hudBest.textContent = b ? formatTime(b) : '—'
    this.startBest.textContent = b ? `Tvůj rekord: ${formatTime(b)}` : ''
  }

  // ── žebříček ──
  async refreshBoards() {
    try {
      this.lastBoard = await fetchBoard()
      this._renderAll()
    } catch {
      this.startTop3.replaceChildren(this._muted('Žebříček není dostupný'))
    }
  }

  _muted(text) {
    const el = document.createElement('div')
    el.className = 'muted'
    el.textContent = text
    return el
  }

  _row(medal, name, ms) {
    const row = document.createElement('div')
    row.className = 'row'
    const m = document.createElement('span'); m.className = 'medal'; m.textContent = medal
    const n = document.createElement('span'); n.className = 'name'; n.textContent = name
    const t = document.createElement('span'); t.className = 'time'; t.textContent = formatTime(ms)
    row.append(m, n, t)
    return row
  }

  _fillList(ol, entries) {
    ol.replaceChildren()
    if (!entries.length) {
      const li = document.createElement('li')
      li.className = 'empty'
      li.textContent = 'Zatím žádný čas'
      ol.appendChild(li)
      return
    }
    for (const e of entries) {
      const li = document.createElement('li')
      const n = document.createElement('span'); n.className = 'name'; n.textContent = e.name
      const t = document.createElement('span'); t.className = 'time'; t.textContent = formatTime(e.ms)
      li.append(n, t)
      ol.appendChild(li)
    }
  }

  _renderAll() {
    const b = this.lastBoard
    if (!b) return

    // start screen: TOP 3 dneška (fallback all-time, když dnes nikdo nehrál)
    const medals = ['🥇', '🥈', '🥉']
    const top3src = b.today.length ? b.today : b.allTime
    const top3label = b.today.length ? 'Dnes nejrychlejší:' : 'Nejrychlejší všech dob:'
    this.startTop3.replaceChildren()
    if (top3src.length) {
      this.startTop3.appendChild(this._muted(top3label))
      top3src.slice(0, 3).forEach((e, i) => {
        this.startTop3.appendChild(this._row(medals[i], e.name, e.ms))
      })
    }

    // overlay: dnes + all-time + ATH
    this._fillList(document.getElementById('board-today'), b.today)
    this._fillList(document.getElementById('board-alltime'), b.allTime)
    const ath = document.getElementById('board-ath')
    ath.textContent = b.ath
      ? `👑 ATH — nejlepší čas všech dob: ${b.ath.name} · ${formatTime(b.ath.ms)} (${b.ath.date})`
      : ''

    // win overlay board: dnes TOP 10 + ATH pod tím
    this.winBoard.replaceChildren()
    if (b.today.length) {
      this.winBoard.appendChild(this._muted(`Dnes TOP 10 (${b.date}):`))
      b.today.forEach((e, i) => {
        this.winBoard.appendChild(this._row(medals[i] || `${i + 1}.`, e.name, e.ms))
      })
    }
    if (b.ath) {
      this.winBoard.appendChild(this._muted(`👑 ATH: ${b.ath.name} · ${formatTime(b.ath.ms)} (${b.ath.date})`))
    }
  }

  // Zavolat na startu kola — vyžádá podepsaný token pro ověření času.
  async beginRun() {
    this.runToken = null
    try { this.runToken = await requestSession() } catch { /* offline → submit selže hláškou */ }
  }

  async _submit() {
    if (this.lastRunMs == null) return
    const name = this.nameInput.value.trim()
    if (!name) { this.nameInput.focus(); return }
    saveName(name)
    const btn = document.getElementById('save-score-btn')
    btn.disabled = true
    btn.textContent = 'Ukládám…'
    try {
      if (!this.runToken) this.runToken = await requestSession() // fallback
      this.lastBoard = await submitScore(name, this.lastRunMs, this.runToken)
      this.saveScoreBox.classList.add('done')
      this._renderAll()
    } catch (e) {
      btn.textContent = 'Zkusit znovu'
      this.winBoard.replaceChildren(this._muted(`Uložení selhalo: ${e.message}`))
    } finally {
      btn.disabled = false
      if (this.saveScoreBox.classList.contains('done')) btn.textContent = 'Uložit čas'
    }
  }

  showBoard() {
    this.refreshBoards()
    this.boardOverlay.classList.remove('hidden')
  }

  // ── obrazovky ──
  showStart() {
    this.startScreen.classList.remove('hidden')
    this.winOverlay.classList.add('hidden')
    this.resumeOverlay.classList.add('hidden')
    this.hud.classList.remove('visible')
    this._refreshBestLabels()
    this.refreshBoards()
  }

  showPlaying(isTouch) {
    this.startScreen.classList.add('hidden')
    this.winOverlay.classList.add('hidden')
    this.resumeOverlay.classList.add('hidden')
    this.boardOverlay.classList.add('hidden')
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

  /** @returns true pokud jde o nový lokální rekord */
  showWin(ms) {
    const prevBest = this.best
    const isRecord = !prevBest || ms < prevBest
    if (isRecord) localStorage.setItem(BEST_KEY, String(Math.round(ms)))

    this.lastRunMs = ms
    this.finalTime.textContent = formatTime(ms)
    this.recordBadge.classList.toggle('show', isRecord)
    const b = this.best
    this.winBest.textContent = b ? `Nejlepší čas: ${formatTime(b)}` : ''

    // reset submit UI pro nové kolo
    this.saveScoreBox.classList.remove('done')
    const btn = document.getElementById('save-score-btn')
    btn.disabled = false
    btn.textContent = 'Uložit čas'
    this.nameInput.value = getSavedName()

    this.winOverlay.classList.remove('hidden')
    this.hud.classList.remove('visible')
    document.getElementById('touch-ui').classList.remove('visible')
    this.refreshBoards()
    return isRecord
  }

  showResume() {
    this.resumeOverlay.classList.remove('hidden')
  }

  hideResume() {
    this.resumeOverlay.classList.add('hidden')
  }
}
