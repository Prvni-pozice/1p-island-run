// player.js — first-person hráč: AABB kolize s voxely, gravitace, skok, voda.
// Žádná fyzikální knihovna — osově oddělený pohyb + clamp na hrany bloků.
import * as THREE from 'three'
import { WATER_LEVEL } from './world.js'

const GRAVITY = 24
const JUMP_SPEED = 8.6
const WALK_SPEED = 5.6
const AIR_CONTROL = 0.55
const WATER_SPEED = 2.6

export class Player {
  constructor(world) {
    this.world = world
    this.radius = 0.3
    this.height = 1.8
    this.eyeHeight = 1.62
    this.pos = new THREE.Vector3()   // střed podstavy (nohy)
    this.vel = new THREE.Vector3()
    this.onGround = false
    this.inWater = false
    this.onSplash = null // callback(pos) — šplouchnutí

    this.spawn()
  }

  spawn() {
    const p = this.world.randomLandPosition(1)
    this.pos.set(p.x, p.y + 0.1, p.z)
    this.vel.set(0, 0, 0)
    this.spawnPoint = this.pos.clone()
  }

  get eyePosition() {
    return new THREE.Vector3(this.pos.x, this.pos.y + this.eyeHeight, this.pos.z)
  }

  /**
   * @param dt   delta čas
   * @param move {x, y} strafe/forward v rozsahu -1..1 (už v prostoru kamery)
   * @param yaw  úhel kamery (rad)
   * @param jump bool — drží skok
   */
  update(dt, move, yaw, jump) {
    const wasInWater = this.inWater
    const feetY = this.pos.y + 0.3
    const terrainBelow = this.world.terrainHeight(this.pos.x, this.pos.z)
    this.inWater = feetY < this.world.waterY && terrainBelow <= WATER_LEVEL

    if (!wasInWater && this.inWater && this.vel.y < -3 && this.onSplash) {
      this.onSplash(new THREE.Vector3(this.pos.x, this.world.waterY, this.pos.z))
    }

    // směr pohybu z kamery (yaw)
    const sin = Math.sin(yaw), cos = Math.cos(yaw)
    const dx = move.x * cos - move.y * sin
    const dz = -move.y * cos - move.x * sin

    const speed = this.inWater ? WATER_SPEED : WALK_SPEED
    const control = this.onGround || this.inWater ? 1 : AIR_CONTROL
    const targetVx = dx * speed
    const targetVz = dz * speed
    const lerp = Math.min(1, dt * 10 * control)
    this.vel.x += (targetVx - this.vel.x) * lerp
    this.vel.z += (targetVz - this.vel.z) * lerp

    if (this.inWater) {
      this.vel.y -= GRAVITY * 0.25 * dt
      this.vel.y = Math.max(this.vel.y, -2.2)
      if (jump) this.vel.y = Math.min(this.vel.y + 22 * dt, 3.2) // pádlování nahoru
    } else {
      this.vel.y -= GRAVITY * dt
      if (jump && this.onGround) {
        this.vel.y = JUMP_SPEED
        this.onGround = false
      }
    }

    this._moveAxis('x', this.vel.x * dt)
    this._moveAxis('z', this.vel.z * dt)
    this.onGround = false
    this._moveAxis('y', this.vel.y * dt)

    // spadl z ostrova do hloubky → respawn na spawn point
    if (this.pos.y < -12) {
      this.pos.copy(this.spawnPoint)
      this.vel.set(0, 0, 0)
    }
  }

  _aabb(pos) {
    return {
      minX: pos.x - this.radius, maxX: pos.x + this.radius,
      minY: pos.y, maxY: pos.y + this.height,
      minZ: pos.z - this.radius, maxZ: pos.z + this.radius,
    }
  }

  _moveAxis(axis, delta) {
    if (delta === 0) return
    this.pos[axis] += delta
    const box = this._aabb(this.pos)

    const x0 = Math.floor(box.minX), x1 = Math.floor(box.maxX - 1e-7)
    const y0 = Math.floor(box.minY), y1 = Math.floor(box.maxY - 1e-7)
    const z0 = Math.floor(box.minZ), z1 = Math.floor(box.maxZ - 1e-7)

    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          if (!this.world.isSolid(x, y, z)) continue
          if (axis === 'x') {
            this.pos.x = delta > 0 ? x - this.radius - 1e-4 : x + 1 + this.radius + 1e-4
            this.vel.x = 0
          } else if (axis === 'z') {
            this.pos.z = delta > 0 ? z - this.radius - 1e-4 : z + 1 + this.radius + 1e-4
            this.vel.z = 0
          } else {
            if (delta > 0) {
              this.pos.y = y - this.height - 1e-4
            } else {
              this.pos.y = y + 1
              this.onGround = true
            }
            this.vel.y = 0
          }
          return this._recheck(axis, delta)
        }
      }
    }
  }

  // po korekci může AABB pořád protínat jiný blok (roh) — jeden dodatečný průchod
  _recheck(axis, delta) {
    const box = this._aabb(this.pos)
    const x0 = Math.floor(box.minX), x1 = Math.floor(box.maxX - 1e-7)
    const y0 = Math.floor(box.minY), y1 = Math.floor(box.maxY - 1e-7)
    const z0 = Math.floor(box.minZ), z1 = Math.floor(box.maxZ - 1e-7)
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          if (!this.world.isSolid(x, y, z)) continue
          if (axis === 'x') this.pos.x = delta > 0 ? x - this.radius - 1e-4 : x + 1 + this.radius + 1e-4
          else if (axis === 'z') this.pos.z = delta > 0 ? z - this.radius - 1e-4 : z + 1 + this.radius + 1e-4
          else if (delta > 0) this.pos.y = y - this.height - 1e-4
          else { this.pos.y = y + 1; this.onGround = true }
          return
        }
      }
    }
  }
}
