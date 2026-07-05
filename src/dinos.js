// dinos.js — 8 sběratelných voxel dinosaurů. Dotyk hráče = jednorázový bonus
// (-10 s z času) za každého. Po sebrání dino zajásá, zmenší se a zmizí.
import * as THREE from 'three'
import { SIZE, WATER_LEVEL } from './world.js'

const BONUS_MS = 10000

// barevné varianty (brontosaurus-styl: tělo + krk + hlava + ocas + nohy)
const PALETTE = [
  { body: 0x5fae52, belly: 0x8fd07f, spike: 0x3c7a35 },
  { body: 0x4bb0a6, belly: 0x86d8cf, spike: 0x2f7c74 },
  { body: 0x8a9f4b, belly: 0xc3d488, spike: 0x5f6f31 },
  { body: 0x9c6bd0, belly: 0xcaa6ec, spike: 0x6e4497 },
  { body: 0xd08a4b, belly: 0xecc088, spike: 0x975f2f },
  { body: 0x5f86c8, belly: 0x9db8e6, spike: 0x3d5a94 },
]

function scaleTexture(base, rng) {
  const c = document.createElement('canvas')
  c.width = c.height = 32
  const ctx = c.getContext('2d')
  const col = new THREE.Color(base)
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const v = (rng() - 0.5) * 0.14
    ctx.fillStyle = `rgb(${Math.max(0, Math.min(255, (col.r + v) * 255)) | 0},${Math.max(0, Math.min(255, (col.g + v) * 255)) | 0},${Math.max(0, Math.min(255, (col.b + v) * 255)) | 0})`
    ctx.fillRect(x, y, 1, 1)
  }
  // šupinatý vzor
  ctx.fillStyle = 'rgba(0,0,0,0.10)'
  for (let i = 0; i < 22; i++) ctx.fillRect((rng() * 30) | 0, (rng() * 30) | 0, 2, 2)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.magFilter = THREE.NearestFilter
  return tex
}

class Dino {
  constructor(pal, world, rng, spawnCenter) {
    this.world = world
    this.rng = rng
    this.collected = false
    this.collectT = 0

    const bodyMat = new THREE.MeshLambertMaterial({ map: scaleTexture(pal.body, rng) })
    const bellyMat = new THREE.MeshLambertMaterial({ color: pal.belly })
    const spikeMat = new THREE.MeshLambertMaterial({ color: pal.spike })

    const g = new THREE.Group()
    const add = (geo, mat, x, y, z) => {
      const m = new THREE.Mesh(geo, mat)
      m.position.set(x, y, z)
      m.castShadow = true
      g.add(m)
      return m
    }

    // tělo (délka ve směru z)
    add(new THREE.BoxGeometry(0.9, 0.7, 1.5), bodyMat, 0, 1.0, 0)
    add(new THREE.BoxGeometry(0.7, 0.22, 1.3), bellyMat, 0, 0.66, 0) // světlejší břicho
    // krk + hlava (dopředu +z)
    add(new THREE.BoxGeometry(0.36, 0.9, 0.36), bodyMat, 0, 1.55, 0.72)
    const head = add(new THREE.BoxGeometry(0.5, 0.44, 0.6), bodyMat, 0, 2.05, 0.95)
    // oči
    add(new THREE.BoxGeometry(0.1, 0.1, 0.1), spikeMat, 0.2, 2.16, 1.2)
    add(new THREE.BoxGeometry(0.1, 0.1, 0.1), spikeMat, -0.2, 2.16, 1.2)
    // ocas (dozadu -z, klesá)
    add(new THREE.BoxGeometry(0.34, 0.34, 0.9), bodyMat, 0, 0.95, -1.05)
    add(new THREE.BoxGeometry(0.2, 0.2, 0.7), bodyMat, 0, 0.8, -1.6)
    // hřbetní ostny
    for (let i = 0; i < 4; i++) {
      add(new THREE.BoxGeometry(0.12, 0.24, 0.16), spikeMat, 0, 1.5, 0.5 - i * 0.42)
    }
    // nohy
    for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
      add(new THREE.BoxGeometry(0.24, 0.6, 0.24), bodyMat, sx * 0.32, 0.32, sz * 0.5)
    }

    this.group = g
    this.mats = [bodyMat, bellyMat, spikeMat]
    this.head = head

    const p = spawnPos(world, spawnCenter, rng)
    this.pos = new THREE.Vector3(p.x, p.y, p.z)
    this.dir = rng() * Math.PI * 2
    this.mode = 'idle'
    this.modeT = 1 + rng() * 2
    this.t = rng() * 10
    g.position.copy(this.pos)
    g.rotation.y = this.dir
  }

  update(dt, playerPos) {
    this.t += dt

    if (this.collected) {
      // jásot: vyskočí, roztočí se, zmenší a zmizí
      this.collectT += dt
      const s = Math.max(0, 1 - this.collectT / 0.7)
      this.group.scale.setScalar(s)
      this.group.position.y = this.pos.y + this.collectT * 3.2
      this.group.rotation.y += dt * 12
      if (s <= 0) this.group.visible = false
      return
    }

    this.modeT -= dt
    if (this.modeT <= 0) {
      if (this.mode === 'walk') { this.mode = 'idle'; this.modeT = 0.8 + this.rng() * 2 }
      else { this.mode = 'walk'; this.modeT = 1.5 + this.rng() * 3; this.dir = this.rng() * Math.PI * 2 }
    }

    if (this.mode === 'walk') {
      const step = 1.2 * dt
      const nx = this.pos.x + Math.sin(this.dir) * step
      const nz = this.pos.z + Math.cos(this.dir) * step
      const nH = this.world.groundHeight(nx, nz)
      const curH = this.world.groundHeight(this.pos.x, this.pos.z)
      const onLand = nH > WATER_LEVEL && nx > 2 && nz > 2 && nx < SIZE - 2 && nz < SIZE - 2
      if (onLand && Math.abs(nH - curH) <= 1.05) { this.pos.x = nx; this.pos.z = nz }
      else { this.dir += Math.PI * (0.5 + this.rng() * 0.8); this.modeT = Math.max(this.modeT, 1) }
    }

    const groundY = this.world.groundHeight(this.pos.x, this.pos.z)
    this.pos.y += (groundY - this.pos.y) * Math.min(1, dt * 10)
    this.group.position.set(this.pos.x, this.pos.y, this.pos.z)
    this.group.rotation.y = this.dir
    // pohupování hlavou
    this.head.rotation.x = Math.sin(this.t * 2) * 0.12
    if (this.mode === 'walk') this.group.position.y += Math.abs(Math.sin(this.t * 7)) * 0.05
  }

  collect() {
    this.collected = true
    this.collectT = 0
  }
}

function spawnPos(world, center, rng, rMin = 8, rMax = 60) {
  if (center) {
    for (let i = 0; i < 200; i++) {
      const ang = rng() * Math.PI * 2
      const r = rMin + rng() * (rMax - rMin)
      const x = center.x + Math.cos(ang) * r
      const z = center.z + Math.sin(ang) * r
      if (x < 3 || z < 3 || x > SIZE - 3 || z > SIZE - 3) continue
      const th = world.terrainHeight(x, z)
      const gh = world.groundHeight(x, z)
      if (th > WATER_LEVEL && Math.abs(gh - th) < 0.5) return new THREE.Vector3(x, gh, z)
    }
  }
  return world.randomLandPosition(1)
}

export class Dinos {
  constructor(scene, world, rng, spawnCenter = null) {
    this.scene = scene
    this.total = 8
    this.collectedCount = 0
    this.list = []
    for (let i = 0; i < this.total; i++) {
      const pal = PALETTE[i % PALETTE.length]
      const d = new Dino(pal, world, rng, spawnCenter)
      this.list.push(d)
      scene.add(d.group)
    }
  }

  /** @param collectible bool — sbírat jen ve hře; onCollect(dino, bonusMs, count) */
  update(dt, playerPos, collectible, onCollect) {
    for (const d of this.list) {
      d.update(dt, playerPos)
      if (collectible && !d.collected && d.group.visible) {
        const dx = d.pos.x - playerPos.x, dz = d.pos.z - playerPos.z
        if (dx * dx + dz * dz < 2.4 * 2.4 && Math.abs(d.pos.y - playerPos.y) < 3) {
          d.collect()
          this.collectedCount++
          if (onCollect) onCollect(d, BONUS_MS, this.collectedCount)
        }
      }
    }
  }

  dispose() {
    for (const d of this.list) {
      this.scene.remove(d.group)
      d.group.traverse(o => { if (o.geometry) o.geometry.dispose() })
      for (const m of d.mats) { if (m.map) m.map.dispose(); m.dispose() }
    }
    this.list = []
  }
}
