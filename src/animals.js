// animals.js — 5 druhů voxel zvířat s fotografickými texturami na plochách boxů.
// Textury se načítají z /assets/animals/{nazev}/head.jpg, body.jpg, side.jpg —
// výměna = jen nahradit soubory, kód se nemění. Do načtení (nebo při chybě)
// drží gradient placeholder se jménem druhu.
import * as THREE from 'three'
import { SIZE, WATER_LEVEL } from './world.js'

// Rozměry v blocích: [délka(z), výška, šířka(x)] těla; scale hlavy; barva placeholderu
const SPECIES = [
  { id: 'kapybara', label: 'Kapybara', body: [1.30, 0.68, 0.62], head: 0.46, legH: 0.28, speed: 1.4, count: [2, 3], colors: ['#8a6642', '#5c4128'], ears: true },
  { id: 'morce',    label: 'Morče',    body: [0.72, 0.44, 0.46], head: 0.34, legH: 0.10, speed: 1.1, count: [3, 4], colors: ['#c88f4a', '#f7ecd8'], ears: true },
  { id: 'krecek',   label: 'Křeček',   body: [0.50, 0.34, 0.38], head: 0.28, legH: 0.08, speed: 1.6, count: [2, 4], colors: ['#e8b464', '#fdf3e0'], ears: true },
  { id: 'quokka',   label: 'Quokka',   body: [0.80, 0.52, 0.42], head: 0.38, legH: 0.22, speed: 1.3, count: [2, 3], colors: ['#8f7a58', '#6b5a40'], ears: true, tail: [0.08, 0.08, 0.42] },
  { id: 'cincila',  label: 'Činčila',  body: [0.68, 0.46, 0.40], head: 0.34, legH: 0.14, speed: 1.5, count: [2, 3], colors: ['#9aa0ad', '#6e7480'], ears: true, tail: [0.10, 0.26, 0.10] },
]

function placeholderTexture(label, c1, c2, tag) {
  const canvas = document.createElement('canvas')
  canvas.width = 128; canvas.height = 128
  const ctx = canvas.getContext('2d')
  const grad = ctx.createLinearGradient(0, 0, 128, 128)
  grad.addColorStop(0, c1); grad.addColorStop(1, c2)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, 128, 128)
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  ctx.font = 'bold 20px sans-serif'
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText(label, 64, 58)
  ctx.font = '14px sans-serif'
  ctx.fillText(tag, 64, 82)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

// Sdílené materiály druhu (načtou se jednou, instance je sdílí)
function loadSpeciesMaterials(spec, loader) {
  const make = (file, tag) => {
    const mat = new THREE.MeshLambertMaterial({
      map: placeholderTexture(spec.label, spec.colors[0], spec.colors[1], tag),
    })
    loader.load(
      `/assets/animals/${spec.id}/${file}`,
      tex => {
        tex.colorSpace = THREE.SRGBColorSpace
        mat.map.dispose()
        mat.map = tex
        mat.needsUpdate = true
      },
      undefined,
      () => { /* placeholder zůstává */ },
    )
    return mat
  }
  return { head: make('head.jpg', 'head'), body: make('body.jpg', 'body'), side: make('side.jpg', 'side') }
}

// Najde kousek pevniny poblíž středu (spawn hráče) — zvířata se objeví kolem.
// Kontrola groundHeight == terrainHeight vyloučí vršky palem.
function landNear(world, center, rng, rMin = 3.5, rMax = 13) {
  if (center) {
    for (let i = 0; i < 200; i++) {
      const ang = rng() * Math.PI * 2
      const r = rMin + rng() * (rMax - rMin)
      const x = center.x + Math.cos(ang) * r
      const z = center.z + Math.sin(ang) * r
      if (x < 2 || z < 2 || x > SIZE - 2 || z > SIZE - 2) continue
      const th = world.terrainHeight(x, z)
      const gh = world.groundHeight(x, z)
      if (th > WATER_LEVEL && Math.abs(gh - th) < 0.5) {
        return new THREE.Vector3(x, gh, z)
      }
    }
  }
  return world.randomLandPosition(1)
}

class Animal {
  constructor(spec, mats, world, rng, spawnCenter) {
    this.spec = spec
    this.world = world
    this.rng = rng

    const [L, H, W] = spec.body
    const g = new THREE.Group()

    // Tělo: strany (±x) = side.jpg, zbytek body.jpg. BoxGeometry groups: +x,-x,+y,-y,+z,-z
    const bodyGeo = new THREE.BoxGeometry(W, H, L)
    const bodyMesh = new THREE.Mesh(bodyGeo, [mats.side, mats.side, mats.body, mats.body, mats.body, mats.body])
    bodyMesh.position.y = spec.legH + H / 2
    bodyMesh.castShadow = true
    g.add(bodyMesh)

    // Hlava: čelo (+z, směr pohybu) = head.jpg, zbytek side.jpg
    const hs = spec.head
    const headGeo = new THREE.BoxGeometry(hs, hs, hs)
    const headMesh = new THREE.Mesh(headGeo, [mats.side, mats.side, mats.side, mats.side, mats.head, mats.side])
    headMesh.position.set(0, spec.legH + H * 0.78, L / 2 + hs / 2 - 0.06)
    headMesh.castShadow = true
    g.add(headMesh)

    // Uši
    if (spec.ears) {
      const earGeo = new THREE.BoxGeometry(hs * 0.28, hs * 0.34, hs * 0.14)
      for (const sx of [-1, 1]) {
        const ear = new THREE.Mesh(earGeo, mats.body)
        ear.position.set(sx * hs * 0.32, headMesh.position.y + hs * 0.62, headMesh.position.z - hs * 0.1)
        ear.castShadow = true
        g.add(ear)
      }
    }

    // Ocas
    if (spec.tail) {
      const [tw, th, tl] = spec.tail
      const tail = new THREE.Mesh(new THREE.BoxGeometry(tw, th, tl), mats.body)
      tail.position.set(0, spec.legH + H * 0.55, -L / 2 - tl / 2 + 0.04)
      tail.castShadow = true
      g.add(tail)
    }

    // Nohy
    const legGeo = new THREE.BoxGeometry(0.13, spec.legH + 0.02, 0.13)
    for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
      const leg = new THREE.Mesh(legGeo, mats.body)
      leg.position.set(sx * (W / 2 - 0.08), (spec.legH + 0.02) / 2, sz * (L / 2 - 0.1))
      leg.castShadow = true
      g.add(leg)
    }

    this.group = g

    // AI stav — spawn poblíž hráče (rozprchnou se samy)
    const p = landNear(world, spawnCenter, rng)
    this.pos = new THREE.Vector3(p.x, p.y, p.z)
    this.dir = rng() * Math.PI * 2
    this.mode = 'idle'
    this.modeT = 1 + rng() * 2
    this.t = rng() * 10
    this.hopVel = 0
    this.hopY = 0
    this.hopCooldown = 0

    g.position.copy(this.pos)
  }

  update(dt, playerPos) {
    this.t += dt
    this.modeT -= dt
    this.hopCooldown -= dt

    if (this.modeT <= 0) {
      if (this.mode === 'walk') {
        this.mode = 'idle'
        this.modeT = 0.8 + this.rng() * 2.4
      } else {
        this.mode = 'walk'
        this.modeT = 1.5 + this.rng() * 3.5
        this.dir = this.rng() * Math.PI * 2
      }
    }

    if (this.mode === 'walk') {
      const step = this.spec.speed * dt
      const nx = this.pos.x + Math.sin(this.dir) * step
      const nz = this.pos.z + Math.cos(this.dir) * step
      const curH = this.world.groundHeight(this.pos.x, this.pos.z)
      const nH = this.world.groundHeight(nx, nz)
      const onLand = nH > WATER_LEVEL && nx > 2 && nz > 2 && nx < SIZE - 2 && nz < SIZE - 2
      const climbable = Math.abs(nH - curH) <= 1.05
      if (onLand && climbable) {
        this.pos.x = nx; this.pos.z = nz
      } else {
        this.dir += Math.PI * (0.5 + this.rng() * 0.8) // otočka od překážky/vody
        this.modeT = Math.max(this.modeT, 1)
      }
    }

    // poskočení při přiblížení hráče
    const distToPlayer = this.pos.distanceTo(playerPos)
    if (distToPlayer < 3.6 && this.hopCooldown <= 0 && this.hopY <= 0) {
      this.hopVel = 3.4
      this.hopCooldown = 3 + this.rng() * 2
    }
    if (this.hopVel !== 0 || this.hopY > 0) {
      this.hopY += this.hopVel * dt
      this.hopVel -= 22 * dt
      if (this.hopY <= 0) { this.hopY = 0; this.hopVel = 0 }
    }

    // usazení na terén
    const groundY = this.world.groundHeight(this.pos.x, this.pos.z)
    this.pos.y += (groundY - this.pos.y) * Math.min(1, dt * 12)

    this.group.position.set(this.pos.x, this.pos.y + this.hopY, this.pos.z)
    this.group.rotation.y = this.dir

    // waddle při chůzi
    if (this.mode === 'walk') {
      this.group.rotation.z = Math.sin(this.t * 9) * 0.05
      this.group.position.y += Math.abs(Math.sin(this.t * 9)) * 0.04
    } else {
      this.group.rotation.z *= 0.9
    }
  }
}

export class Animals {
  constructor(scene, world, rng, spawnCenter = null) {
    this.scene = scene
    this.list = []
    this.loader = new THREE.TextureLoader()
    this.materials = new Map()

    for (const spec of SPECIES) {
      if (!this.materials.has(spec.id)) {
        this.materials.set(spec.id, loadSpeciesMaterials(spec, this.loader))
      }
      const mats = this.materials.get(spec.id)
      const n = spec.count[0] + Math.floor(rng() * (spec.count[1] - spec.count[0] + 1))
      for (let i = 0; i < n; i++) {
        const a = new Animal(spec, mats, world, rng, spawnCenter)
        this.list.push(a)
        scene.add(a.group)
      }
    }
  }

  update(dt, playerPos) {
    for (const a of this.list) a.update(dt, playerPos)
  }

  dispose() {
    for (const a of this.list) {
      this.scene.remove(a.group)
      a.group.traverse(o => { if (o.geometry) o.geometry.dispose() })
    }
    for (const mats of this.materials.values()) {
      for (const m of Object.values(mats)) {
        if (m.map) m.map.dispose()
        m.dispose()
      }
    }
    this.list = []
    this.materials.clear()
  }
}
