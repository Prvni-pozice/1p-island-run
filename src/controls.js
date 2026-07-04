// controls.js — desktop (Pointer Lock + WASD) i mobil (joystick + drag look).
export function isTouchDevice() {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0
}

export class Controls {
  constructor(canvas) {
    this.canvas = canvas
    this.touch = isTouchDevice()
    this.yaw = 0
    this.pitch = -0.1
    this.keys = new Set()
    this.jumpHeld = false
    this.enabled = false
    this.onLockLost = null

    if (this.touch) this._setupTouch()
    else this._setupDesktop()
  }

  // ── Desktop ──
  _setupDesktop() {
    document.addEventListener('keydown', e => {
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault()
      }
      this.keys.add(e.code)
      if (e.code === 'Space') this.jumpHeld = true
    })
    document.addEventListener('keyup', e => {
      this.keys.delete(e.code)
      if (e.code === 'Space') this.jumpHeld = false
    })
    document.addEventListener('mousemove', e => {
      if (document.pointerLockElement !== this.canvas) return
      this.yaw -= e.movementX * 0.0024
      this.pitch -= e.movementY * 0.0024
      this.pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, this.pitch))
    })
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement !== this.canvas && this.enabled && this.onLockLost) {
        this.onLockLost()
      }
    })
  }

  lock() {
    if (!this.touch && this.canvas.requestPointerLock) {
      // iOS Safari na desktopu vrací promise, chyby ignorujeme (uživatel dá Esc)
      const p = this.canvas.requestPointerLock()
      if (p && p.catch) p.catch(() => {})
    }
  }

  unlock() {
    if (!this.touch && document.exitPointerLock && document.pointerLockElement) {
      document.exitPointerLock()
    }
  }

  // ── Mobil ──
  _setupTouch() {
    this.joyActive = false
    this.joyId = null
    this.joyOrigin = { x: 0, y: 0 }
    this.joyVec = { x: 0, y: 0 }
    this.lookId = null
    this.lookLast = { x: 0, y: 0 }

    this.joyBase = document.getElementById('joystick-base')
    this.joyKnob = document.getElementById('joystick-knob')
    const jumpBtn = document.getElementById('jump-btn')

    jumpBtn.addEventListener('touchstart', e => { e.preventDefault(); this.jumpHeld = true }, { passive: false })
    jumpBtn.addEventListener('touchend', e => { e.preventDefault(); this.jumpHeld = false }, { passive: false })
    jumpBtn.addEventListener('touchcancel', () => { this.jumpHeld = false })

    const area = document.body
    area.addEventListener('touchstart', e => {
      if (!this.enabled) return
      for (const t of e.changedTouches) {
        if (t.target === jumpBtn) continue
        if (t.clientX < window.innerWidth * 0.45 && this.joyId === null) {
          this.joyId = t.identifier
          this.joyOrigin = { x: t.clientX, y: t.clientY }
          this.joyVec = { x: 0, y: 0 }
          this.joyBase.style.display = 'block'
          this.joyBase.style.left = t.clientX + 'px'
          this.joyBase.style.top = t.clientY + 'px'
          this._setKnob(0, 0)
        } else if (this.lookId === null) {
          this.lookId = t.identifier
          this.lookLast = { x: t.clientX, y: t.clientY }
        }
      }
    }, { passive: false })

    area.addEventListener('touchmove', e => {
      if (!this.enabled) return
      e.preventDefault()
      for (const t of e.changedTouches) {
        if (t.identifier === this.joyId) {
          const dx = t.clientX - this.joyOrigin.x
          const dy = t.clientY - this.joyOrigin.y
          const len = Math.hypot(dx, dy)
          const max = 55, dead = 8
          const cl = Math.min(len, max)
          const nx = len > 0 ? dx / len : 0
          const ny = len > 0 ? dy / len : 0
          const mag = len < dead ? 0 : (cl - dead) / (max - dead)
          this.joyVec = { x: nx * mag, y: -ny * mag } // y nahoru = dopředu
          this._setKnob(nx * cl, ny * cl)
        } else if (t.identifier === this.lookId) {
          const dx = t.clientX - this.lookLast.x
          const dy = t.clientY - this.lookLast.y
          this.lookLast = { x: t.clientX, y: t.clientY }
          this.yaw -= dx * 0.0045
          this.pitch -= dy * 0.0045
          this.pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, this.pitch))
        }
      }
    }, { passive: false })

    const endTouch = e => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.joyId) {
          this.joyId = null
          this.joyVec = { x: 0, y: 0 }
          this.joyBase.style.display = 'none'
        } else if (t.identifier === this.lookId) {
          this.lookId = null
        }
      }
    }
    area.addEventListener('touchend', endTouch)
    area.addEventListener('touchcancel', endTouch)
  }

  _setKnob(dx, dy) {
    this.joyKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`
  }

  /** Pohybový vektor {x: strafe (+doprava), y: forward (+dopředu)} v rozsahu -1..1 */
  getMove() {
    if (this.touch) return { ...this.joyVec }
    let x = 0, y = 0
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y += 1
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y -= 1
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1
    const len = Math.hypot(x, y)
    if (len > 1) { x /= len; y /= len }
    return { x, y }
  }
}
