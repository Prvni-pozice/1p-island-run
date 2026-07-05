// world.js — procedurální voxel ostrov: terén, palmy, voda, obloha-podpora,
// mraky a světlušky. Jedna merged geometrie pro celý ostrov (1 draw call).
import * as THREE from 'three'
import { createNoise2D } from 'simplex-noise'

export const SIZE = 256       // půdorys ostrova v blocích
export const HEIGHT = 30      // max výška sloupce
export const WATER_LEVEL = 4  // index bloku hladiny; vodní plocha ~y=4.3

// Block IDs
const AIR = 0, GRASS = 1, DIRT = 2, STONE = 3, SAND = 4, WOOD = 5, LEAVES = 6

// Atlas: 4×4 dlaždice po 32 px → indexy
const TILE = { GRASS_TOP: 0, GRASS_SIDE: 1, DIRT: 2, STONE: 3, SAND: 4, WOOD_SIDE: 5, WOOD_TOP: 6, LEAVES: 7 }

function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ── Procedurální textury bloků (32×32, Minecraft look) ──────────────
function drawTile(ctx, tx, ty, base, variation, decorator) {
  const S = 32, ox = tx * S, oy = ty * S
  const rng = mulberry32(tx * 7919 + ty * 104729 + 13)
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const v = (rng() - 0.5) * 2 * variation
      const r = Math.max(0, Math.min(255, base[0] + v * 255))
      const g = Math.max(0, Math.min(255, base[1] + v * 255))
      const b = Math.max(0, Math.min(255, base[2] + v * 255))
      ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`
      ctx.fillRect(ox + x, oy + y, 1, 1)
    }
  }
  if (decorator) decorator(ctx, ox, oy, S, rng)
}

function buildAtlasTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 128; canvas.height = 128
  const ctx = canvas.getContext('2d')

  drawTile(ctx, 0, 0, [104, 186, 74], 0.055)                  // grass top (sytější zeleň)
  drawTile(ctx, 1, 0, [172, 130, 88], 0.05, (c, ox, oy, S, rng) => { // grass side (světlejší hlína)
    for (let x = 0; x < S; x++) {
      const h = 5 + Math.floor(rng() * 4)
      for (let y = 0; y < h; y++) {
        c.fillStyle = `rgb(${94 + rng() * 26 | 0},${172 + rng() * 26 | 0},${64 + rng() * 22 | 0})`
        c.fillRect(ox + x, oy + y, 1, 1)
      }
    }
  })
  drawTile(ctx, 2, 0, [172, 130, 88], 0.06)                   // dirt (světlejší, čitelnější stěny)
  drawTile(ctx, 3, 0, [128, 130, 134], 0.05, (c, ox, oy, S, rng) => { // stone specks
    for (let i = 0; i < 26; i++) {
      c.fillStyle = 'rgba(70,72,76,0.55)'
      c.fillRect(ox + (rng() * S | 0), oy + (rng() * S | 0), 2, 1)
    }
  })
  drawTile(ctx, 0, 1, [226, 208, 158], 0.035)                 // sand
  drawTile(ctx, 1, 1, [150, 112, 72], 0.04, (c, ox, oy, S) => { // wood side stripes
    for (let x = 0; x < S; x += 5) { c.fillStyle = 'rgba(96,68,40,0.4)'; c.fillRect(ox + x, oy, 1, S) }
  })
  drawTile(ctx, 2, 1, [176, 140, 92], 0.04, (c, ox, oy, S) => { // wood top rings
    c.strokeStyle = 'rgba(120,90,54,0.55)'
    for (let r = 4; r < 16; r += 5) { c.strokeRect(ox + 16 - r, oy + 16 - r, r * 2, r * 2) }
  })
  drawTile(ctx, 3, 1, [86, 176, 74], 0.085, (c, ox, oy, S, rng) => { // leaves holes
    for (let i = 0; i < 18; i++) {
      c.fillStyle = 'rgba(52,120,48,0.6)'
      c.fillRect(ox + (rng() * S | 0), oy + (rng() * S | 0), 2, 2)
    }
  })

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.magFilter = THREE.NearestFilter
  tex.minFilter = THREE.NearestMipmapLinearFilter
  tex.generateMipmaps = true
  tex.anisotropy = 4
  return tex
}

// tile index → UV lookup (index v atlasu: sloupec = i%4, řádek = floor(i/4))
const TILE_XY = [
  [0, 0], [1, 0], [2, 0], [3, 0], // grass_top, grass_side, dirt, stone
  [0, 1], [1, 1], [2, 1], [3, 1], // sand, wood_side, wood_top, leaves
]
function tileUV(tile) {
  const [tx, ty] = TILE_XY[tile]
  const pad = 0.06 / 4 // ochrana proti mip bleedingu
  const u0 = tx / 4 + pad, v1 = 1 - ty / 4 - pad
  const u1 = (tx + 1) / 4 - pad, v0 = 1 - (ty + 1) / 4 + pad
  return { u0, v0, u1, v1 }
}

// Dlaždice podle bloku a strany (face: 0..5 = +x,-x,+y,-y,+z,-z)
function tileFor(block, face) {
  switch (block) {
    case GRASS: return face === 2 ? TILE.GRASS_TOP : face === 3 ? TILE.DIRT : TILE.GRASS_SIDE
    case DIRT: return TILE.DIRT
    case STONE: return TILE.STONE
    case SAND: return TILE.SAND
    case WOOD: return (face === 2 || face === 3) ? TILE.WOOD_TOP : TILE.WOOD_SIDE
    case LEAVES: return TILE.LEAVES
    default: return TILE.DIRT
  }
}

// Definice 6 stěn: normála + tangenty (pro rohy a AO)
const FACES = [
  { n: [1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },   // +x
  { n: [-1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] }, // -x
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, 1] },   // +y
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, -1] }, // -y
  { n: [0, 0, 1], u: [-1, 0, 0], v: [0, 1, 0] },  // +z
  { n: [0, 0, -1], u: [1, 0, 0], v: [0, 1, 0] },  // -z
]

export class World {
  constructor(scene, seed = (Math.random() * 2 ** 31) | 0) {
    this.scene = scene
    this.seed = seed
    this.rng = mulberry32(seed)
    this.noise2D = createNoise2D(this.rng)
    this.noiseDetail = createNoise2D(mulberry32(seed ^ 0x9e3779b9))
    this.blocks = new Uint8Array(SIZE * SIZE * HEIGHT)
    this.heightMap = new Float32Array(SIZE * SIZE)
    this.group = new THREE.Group()
    this.time = 0

    this._generateTerrain()
    this._raiseVolcano()   // vždy jedna sopka (mění bloky + heightmapu)
    this._plantPalms()
    this._planMeadow()     // vybere plochý 8×8 patch pro louku
    this._buildMesh()
    this._buildWater()
    this._buildVolcanoLava() // láva, světlo, kouř (samostatné meshe)
    this._buildMeadow()    // květiny (InstancedMesh)
    this._buildClouds()
    this._buildFireflies()

    scene.add(this.group)
  }

  // ── data přístup ──
  _idx(x, y, z) { return (y * SIZE + z) * SIZE + x }
  getBlock(x, y, z) {
    if (x < 0 || z < 0 || x >= SIZE || z >= SIZE || y < 0 || y >= HEIGHT) return AIR
    return this.blocks[this._idx(x, y, z)]
  }
  setBlock(x, y, z, id) {
    if (x < 0 || z < 0 || x >= SIZE || z >= SIZE || y < 0 || y >= HEIGHT) return
    this.blocks[this._idx(x, y, z)] = id
  }
  isSolid(x, y, z) { return this.getBlock(x, y, z) !== AIR }

  // Je pozice uvnitř květnaté louky (8×8 patch)?
  inMeadow(x, z) {
    if (!this.meadow) return false
    const { x0, z0 } = this.meadow
    return x >= x0 && x < x0 + 8 && z >= z0 && z < z0 + 8
  }

  // Nejvyšší pevný blok + 1 (= y kam lze postavit entitu)
  groundHeight(x, z) {
    const bx = Math.floor(x), bz = Math.floor(z)
    if (bx < 0 || bz < 0 || bx >= SIZE || bz >= SIZE) return 0
    for (let y = HEIGHT - 1; y >= 0; y--) {
      if (this.isSolid(bx, y, bz)) return y + 1
    }
    return 0
  }

  // Výška terénu bez palem (z heightmapy)
  terrainHeight(x, z) {
    const bx = Math.floor(x), bz = Math.floor(z)
    if (bx < 0 || bz < 0 || bx >= SIZE || bz >= SIZE) return 0
    return this.heightMap[bz * SIZE + bx]
  }

  randomLandPosition(minAbove = 1, tries = 400) {
    for (let i = 0; i < tries; i++) {
      const x = 4 + Math.floor(this.rng() * (SIZE - 8))
      const z = 4 + Math.floor(this.rng() * (SIZE - 8))
      const h = this.heightMap[z * SIZE + x]
      if (h >= WATER_LEVEL + minAbove && this.getBlock(x, h, z) === AIR && this.getBlock(x, h + 1, z) === AIR) {
        return new THREE.Vector3(x + 0.5, h, z + 0.5)
      }
    }
    return new THREE.Vector3(SIZE / 2, this.heightMap[(SIZE / 2) * SIZE + SIZE / 2], SIZE / 2)
  }

  // ── generování ──
  _generateTerrain() {
    const C = SIZE / 2
    for (let z = 0; z < SIZE; z++) {
      for (let x = 0; x < SIZE; x++) {
        const nx = (x - C) / C, nz = (z - C) / C
        const d = Math.sqrt(nx * nx + nz * nz)
        const falloff = Math.max(0, 1 - d * d * 1.45)
        // větší ostrov → nižší frekvence pro velké tvary + střední a jemný detail
        const base = this.noise2D(x * 0.013, z * 0.013) * 0.5 + 0.5
        const mid = this.noise2D(x * 0.045, z * 0.045) * 0.5 + 0.5
        const detail = this.noiseDetail(x * 0.14, z * 0.14) * 0.5 + 0.5
        let h = Math.floor((base * 0.6 + mid * 0.27 + detail * 0.13) * 18 * falloff + 2)
        h = Math.max(2, Math.min(HEIGHT - 8, h)) // min 2 = mořské dno, strop kvůli palmám
        this.heightMap[z * SIZE + x] = h

        for (let y = 0; y < h; y++) {
          let id
          if (y < h - 3) id = STONE
          else if (y < h - 1) id = DIRT
          else id = (h <= WATER_LEVEL + 1) ? SAND : GRASS
          // pláž: horní vrstvy u vody z písku
          if (h <= WATER_LEVEL + 2 && y >= h - 3) id = SAND
          this.setBlock(x, y, z, id)
        }
      }
    }
  }

  _plantPalms() {
    const spots = []
    const count = 42 + Math.floor(this.rng() * 16)
    for (let i = 0; i < 4000 && spots.length < count; i++) {
      const x = 6 + Math.floor(this.rng() * (SIZE - 12))
      const z = 6 + Math.floor(this.rng() * (SIZE - 12))
      const h = this.heightMap[z * SIZE + x]
      if (h < WATER_LEVEL + 1 || h > WATER_LEVEL + 7) continue
      if (spots.some(s => Math.abs(s.x - x) + Math.abs(s.z - z) < 7)) continue
      spots.push({ x, z, h })
    }
    for (const { x, z, h } of spots) {
      const trunkH = 4 + Math.floor(this.rng() * 3)
      for (let y = h; y < h + trunkH; y++) this.setBlock(x, y, z, WOOD)
      const ty = h + trunkH
      // koruna palmy: kříž listů + středová vrstva
      for (let dx = -2; dx <= 2; dx++) {
        for (let dz = -2; dz <= 2; dz++) {
          const man = Math.abs(dx) + Math.abs(dz)
          if (man <= 2 && !(dx === 0 && dz === 0)) this.setBlock(x + dx, ty, z + dz, LEAVES)
        }
      }
      this.setBlock(x, ty, z, LEAVES)
      this.setBlock(x, ty + 1, z, LEAVES)
      // svěšené konce listů
      this.setBlock(x + 3, ty - 1, z, LEAVES); this.setBlock(x - 3, ty - 1, z, LEAVES)
      this.setBlock(x, ty - 1, z + 3, LEAVES); this.setBlock(x, ty - 1, z - 3, LEAVES)
    }
  }

  // ── sopka (vždy jedna) ──
  _raiseVolcano() {
    let cx = SIZE / 2, cz = SIZE / 2, best = -1
    for (let i = 0; i < 500; i++) {
      const x = 46 + Math.floor(this.rng() * (SIZE - 92))
      const z = 46 + Math.floor(this.rng() * (SIZE - 92))
      const h = this.heightMap[z * SIZE + x]
      if (h > best && h >= WATER_LEVEL + 1) { best = h; cx = x; cz = z }
      if (best > WATER_LEVEL + 4) break
    }
    const baseH = this.heightMap[cz * SIZE + cx]
    const baseR = 15
    const peakH = HEIGHT - 2
    const craterR = 4.2
    const craterDepth = 4
    // rim (okraj kráteru) = výška kužele v poloměru kráteru; uvnitř mísa
    const rimY = Math.round(peakH - (craterR / baseR) * (peakH - baseH))
    // barevné pásy podle výšky (odspoda): zeleň → hnědá → šedá → láva navrchu
    const span = Math.max(6, rimY - baseH)
    const lavaFloorY = rimY - 1                                         // ≥2 vrchní vrstvy = láva
    const stoneFloorY = lavaFloorY - Math.max(3, Math.round(span * 0.25)) // horní čtvrtina šedá
    const dirtFloorY = stoneFloorY - 3                                 // pár hnědých vrstev
    this.lavaCells = []
    const lavaSet = new Set()
    const addLava = (x, y, z) => {
      const key = x + ',' + y + ',' + z
      if (!lavaSet.has(key)) { lavaSet.add(key); this.lavaCells.push([x, y, z]) }
    }
    for (let dz = -baseR; dz <= baseR; dz++) {
      for (let dx = -baseR; dx <= baseR; dx++) {
        const x = cx + dx, z = cz + dz
        if (x < 1 || z < 1 || x >= SIZE - 1 || z >= SIZE - 1) continue
        const d = Math.sqrt(dx * dx + dz * dz)
        if (d > baseR) continue
        const inCrater = d < craterR
        let solidTop
        if (inCrater) {
          // mísa: nejhlubší uprostřed, okraj = rimY (vyvýšený val)
          const bowl = craterDepth * (1 - (d / craterR) * (d / craterR))
          solidTop = Math.round(rimY - bowl)
        } else {
          solidTop = Math.round(peakH - (d / baseR) * (peakH - baseH)) // kužel
        }
        for (let y = 0; y <= solidTop; y++) {
          if (this.isSolid(x, y, z)) continue
          const id = y >= stoneFloorY ? STONE : y >= dirtFloorY ? DIRT : GRASS
          this.setBlock(x, y, z, id)
        }
        this.heightMap[z * SIZE + x] = Math.max(this.heightMap[z * SIZE + x], solidTop)
        // lávová čepice: vrchní vrstvy sloupce v láva-pásu (viditelné z dálky)
        if (solidTop >= lavaFloorY) for (let y = lavaFloorY; y <= solidTop; y++) addLava(x, y, z)
        // lávové jezírko v míse (nad dnem po hladinu = rimY)
        if (inCrater) for (let y = solidTop + 1; y <= rimY; y++) { this.setBlock(x, y, z, STONE); addLava(x, y, z) }
      }
    }
    this.volcano = { x: cx, z: cz, craterR, rimY, craterDepth, bowlBottomY: rimY - craterDepth }
  }

  _buildVolcanoLava() {
    const v = this.volcano
    // procedurální lávová textura (emissive → chytá bloom)
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 64
    const ctx = canvas.getContext('2d')
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const r = this.rng()
      ctx.fillStyle = r < 0.15 ? '#ffe25a' : r < 0.5 ? '#ff7a1e' : '#d83a10'
      ctx.fillRect(x, y, 1, 1)
    }
    const lavaTex = new THREE.CanvasTexture(canvas)
    lavaTex.colorSpace = THREE.SRGBColorSpace
    lavaTex.magFilter = THREE.NearestFilter

    // vrchol sopky = poslední 3 vrstvy kostek z žhnoucí lávy (kupolovitě na
    // kráteru, sedí na pevném dně kráteru — nelevituje)
    this.lavaMat = new THREE.MeshStandardMaterial({
      color: 0x2a0f04, emissive: 0xff5a1e, emissiveMap: lavaTex, map: lavaTex,
      emissiveIntensity: 1.7, roughness: 0.7,
    })
    // lávové kostky = vrchní pás sopky + jezírko (spočítáno v _raiseVolcano)
    const cubes = this.lavaCells
    this.lavaCubes = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.lavaMat, cubes.length)
    const cmtx = new THREE.Matrix4()
    for (let i = 0; i < cubes.length; i++) {
      const [x, y, z] = cubes[i]
      cmtx.makeTranslation(x + 0.5, y + 0.5, z + 0.5)
      this.lavaCubes.setMatrixAt(i, cmtx)
    }
    this.lavaCubes.instanceMatrix.needsUpdate = true
    this.group.add(this.lavaCubes)

    this.lavaLight = new THREE.PointLight(0xff6a22, 26, 40)
    this.lavaLight.position.set(v.x + 0.5, v.rimY + 3, v.z + 0.5)
    this.group.add(this.lavaLight)

    // ── stoupající kouř: měkké kulaté chuchvalce (radiální sprite) ──
    const sc = document.createElement('canvas')
    sc.width = sc.height = 64
    const sctx = sc.getContext('2d')
    const grad = sctx.createRadialGradient(32, 32, 0, 32, 32, 32)
    grad.addColorStop(0, 'rgba(255,255,255,1)')
    grad.addColorStop(0.5, 'rgba(255,255,255,0.45)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    sctx.fillStyle = grad
    sctx.fillRect(0, 0, 64, 64)
    const smokeSprite = new THREE.CanvasTexture(sc)

    const N = 96
    this.smokeMaxH = 34
    this.smokeBaseY = v.rimY + 1
    this.smokeY = new Float32Array(N)
    const pos = new Float32Array(N * 3)
    for (let i = 0; i < N; i++) {
      this.smokeY[i] = this.rng() * this.smokeMaxH
      const spread = 1 + this.smokeY[i] * 0.13
      pos[i * 3 + 0] = v.x + 0.5 + (this.rng() - 0.5) * spread
      pos[i * 3 + 1] = this.smokeBaseY + this.smokeY[i]
      pos[i * 3 + 2] = v.z + 0.5 + (this.rng() - 0.5) * spread
    }
    const sgeo = new THREE.BufferGeometry()
    sgeo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    const smat = new THREE.PointsMaterial({
      map: smokeSprite, color: 0xa79e94, size: 4.4,
      transparent: true, opacity: 0.34, depthWrite: false, sizeAttenuation: true,
    })
    this.smoke = new THREE.Points(sgeo, smat)
    this.group.add(this.smoke)
    this.volcanoPos = new THREE.Vector3(v.x + 0.5, v.rimY, v.z + 0.5)
  }

  // ── květnatá louka (max 8×8) ──
  _planMeadow() {
    const v = this.volcano
    for (let i = 0; i < 800; i++) {
      const x0 = 6 + Math.floor(this.rng() * (SIZE - 22))
      const z0 = 6 + Math.floor(this.rng() * (SIZE - 22))
      if (v && Math.hypot(x0 + 4 - v.x, z0 + 4 - v.z) < 24) continue
      const h0 = this.heightMap[z0 * SIZE + x0]
      if (h0 <= WATER_LEVEL + 1) continue
      let ok = true
      for (let dz = 0; dz < 8 && ok; dz++) {
        for (let dx = 0; dx < 8; dx++) {
          const h = this.heightMap[(z0 + dz) * SIZE + (x0 + dx)]
          if (Math.abs(h - h0) > 1 || h <= WATER_LEVEL + 1) { ok = false; break }
        }
      }
      if (ok) { this.meadow = { x0, z0 }; return }
    }
    this.meadow = null
  }

  _buildMeadow() {
    if (!this.meadow) return
    const { x0, z0 } = this.meadow
    const cells = []
    for (let dz = 0; dz < 8; dz++) {
      for (let dx = 0; dx < 8; dx++) {
        if (this.rng() < 0.72) cells.push([x0 + dx, z0 + dz])
      }
    }
    const n = cells.length
    const stemGeo = new THREE.BoxGeometry(0.06, 0.34, 0.06)
    const stemMat = new THREE.MeshLambertMaterial({ color: 0x2f9a3e })
    const stems = new THREE.InstancedMesh(stemGeo, stemMat, n)
    const bloomGeo = new THREE.BoxGeometry(0.24, 0.24, 0.24)
    const bloomMat = new THREE.MeshLambertMaterial()
    const blooms = new THREE.InstancedMesh(bloomGeo, bloomMat, n)
    const palette = [0xff5566, 0xffd23f, 0xffffff, 0xff8fc7, 0xb56cff, 0xff9a3d, 0x6ad1ff]
    const mtx = new THREE.Matrix4()
    const col = new THREE.Color()
    for (let i = 0; i < n; i++) {
      const [x, z] = cells[i]
      const gy = this.heightMap[z * SIZE + x]
      const ox = x + 0.25 + this.rng() * 0.5
      const oz = z + 0.25 + this.rng() * 0.5
      mtx.makeTranslation(ox, gy + 0.17, oz); stems.setMatrixAt(i, mtx)
      mtx.makeTranslation(ox, gy + 0.44, oz); blooms.setMatrixAt(i, mtx)
      col.setHex(palette[Math.floor(this.rng() * palette.length)])
      blooms.setColorAt(i, col)
    }
    stems.instanceMatrix.needsUpdate = true
    blooms.instanceMatrix.needsUpdate = true
    if (blooms.instanceColor) blooms.instanceColor.needsUpdate = true
    stems.castShadow = true
    blooms.castShadow = true
    this.group.add(stems)
    this.group.add(blooms)
    this.meadowCenter = new THREE.Vector3(x0 + 4, this.heightMap[(z0 + 4) * SIZE + (x0 + 4)], z0 + 4)
  }

  // ── meshing s per-vertex AO ──
  _buildMesh() {
    const positions = [], normals = [], uvs = [], colors = [], indices = []
    let vi = 0

    const aoLevel = (side1, side2, corner) => {
      if (side1 && side2) return 3
      return side1 + side2 + corner
    }

    for (let y = 0; y < HEIGHT; y++) {
      for (let z = 0; z < SIZE; z++) {
        for (let x = 0; x < SIZE; x++) {
          const block = this.getBlock(x, y, z)
          if (block === AIR) continue

          for (let f = 0; f < FACES.length; f++) {
            const { n, u, v } = FACES[f]
            const nx = x + n[0], ny = y + n[1], nz = z + n[2]
            if (this.isSolid(nx, ny, nz)) continue // zakrytá stěna

            const tile = tileFor(block, f)
            const { u0, v0, u1, v1 } = tileUV(tile)
            const cx = x + 0.5, cy = y + 0.5, cz = z + 0.5

            // 4 rohy: (su,sv) v pořadí (-1,-1),(1,-1),(1,1),(-1,1)
            const cornerSigns = [[-1, -1], [1, -1], [1, 1], [-1, 1]]
            const cornerUVs = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]
            const ao = []
            for (let c = 0; c < 4; c++) {
              const [su, sv] = cornerSigns[c]
              const px = cx + n[0] * 0.5 + (u[0] * su + v[0] * sv) * 0.5
              const py = cy + n[1] * 0.5 + (u[1] * su + v[1] * sv) * 0.5
              const pz = cz + n[2] * 0.5 + (u[2] * su + v[2] * sv) * 0.5
              positions.push(px, py, pz)
              normals.push(n[0], n[1], n[2])
              uvs.push(cornerUVs[c][0], cornerUVs[c][1])

              // AO: sousedi ve vrstvě před stěnou
              const s1 = this.isSolid(nx + u[0] * su, ny + u[1] * su, nz + u[2] * su) ? 1 : 0
              const s2 = this.isSolid(nx + v[0] * sv, ny + v[1] * sv, nz + v[2] * sv) ? 1 : 0
              const co = this.isSolid(nx + u[0] * su + v[0] * sv, ny + u[1] * su + v[1] * sv, nz + u[2] * su + v[2] * sv) ? 1 : 0
              const a = aoLevel(s1, s2, co)
              ao.push(a)
              const bright = 1 - a * 0.085 // jemné AO — rohy jen lehce ztmavené
              colors.push(bright, bright, bright)
            }

            // flip diagonály podle AO (anizotropie quadu); winding CCW při
            // pohledu zvenku (u×v rohového pořadí míří DOVNITŘ, proto je
            // pořadí indexů obrácené — jinak backface culling stěny zahodí)
            if (ao[0] + ao[2] > ao[1] + ao[3]) {
              indices.push(vi + 1, vi + 3, vi + 2, vi + 1, vi + 0, vi + 3)
            } else {
              indices.push(vi + 0, vi + 2, vi + 1, vi + 0, vi + 3, vi + 2)
            }
            vi += 4
          }
        }
      }
    }

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    geo.setIndex(indices)

    this.atlas = buildAtlasTexture()
    const mat = new THREE.MeshLambertMaterial({ map: this.atlas, vertexColors: true })
    this.terrainMesh = new THREE.Mesh(geo, mat)
    this.terrainMesh.castShadow = true
    this.terrainMesh.receiveShadow = true
    this.group.add(this.terrainMesh)
  }

  // ── voda ──
  _buildWater() {
    // heightmapa terénu jako texture pro mělčinu/pěnu
    const hData = new Uint8Array(SIZE * SIZE)
    for (let i = 0; i < SIZE * SIZE; i++) hData[i] = Math.min(255, this.heightMap[i] / HEIGHT * 255)
    const heightTex = new THREE.DataTexture(hData, SIZE, SIZE, THREE.RedFormat, THREE.UnsignedByteType)
    heightTex.magFilter = THREE.LinearFilter
    heightTex.minFilter = THREE.LinearFilter
    heightTex.needsUpdate = true

    const waterY = WATER_LEVEL + 0.3
    const geo = new THREE.PlaneGeometry(1600, 1600, 128, 128)
    geo.rotateX(-Math.PI / 2)

    this.waterUniforms = {
      uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() },
      uDeep: { value: new THREE.Color(0x0b4a6e) },
      uShallow: { value: new THREE.Color(0x2fb8c9) },
      uSky: { value: new THREE.Color(0x9fd4ef) },
      uHeightTex: { value: heightTex },
      uIslandSize: { value: SIZE },
      uMaxH: { value: HEIGHT },
      uWaterY: { value: waterY },
      uFogColor: { value: new THREE.Color(0xc7dff0) },
      uFogNear: { value: 90 },
      uFogFar: { value: 420 },
    }

    const mat = new THREE.ShaderMaterial({
      uniforms: this.waterUniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */`
        uniform float uTime;
        varying vec3 vWorldPos;
        varying vec3 vNormal;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          float a = 0.07;
          float w1 = sin(wp.x * 0.55 + uTime * 1.5);
          float w2 = sin(wp.z * 0.40 + uTime * 1.1);
          float w3 = sin((wp.x + wp.z) * 0.22 + uTime * 0.7);
          wp.y += (w1 + w2 + w3) * a;
          float dx = 0.55 * cos(wp.x * 0.55 + uTime * 1.5) * a + 0.22 * cos((wp.x + wp.z) * 0.22 + uTime * 0.7) * a;
          float dz = 0.40 * cos(wp.z * 0.40 + uTime * 1.1) * a + 0.22 * cos((wp.x + wp.z) * 0.22 + uTime * 0.7) * a;
          vNormal = normalize(vec3(-dx, 1.0, -dz));
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */`
        uniform float uTime;
        uniform vec3 uSunDir, uDeep, uShallow, uSky, uFogColor;
        uniform sampler2D uHeightTex;
        uniform float uIslandSize, uMaxH, uWaterY, uFogNear, uFogFar;
        varying vec3 vWorldPos;
        varying vec3 vNormal;

        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vnoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
                     mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
        }

        void main() {
          vec2 uv = vWorldPos.xz / uIslandSize;
          float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
          float th = texture2D(uHeightTex, clamp(uv, 0.0, 1.0)).r * uMaxH * inside;
          float depth = uWaterY - th;
          float shallow = (1.0 - smoothstep(0.0, 3.5, depth)) * inside;

          vec3 base = mix(uDeep, uShallow, shallow);
          vec3 viewDir = normalize(cameraPosition - vWorldPos);
          vec3 nrm = normalize(vNormal);
          float fres = pow(1.0 - max(dot(viewDir, nrm), 0.0), 3.0);
          vec3 col = mix(base, uSky, clamp(fres * 0.75 + 0.12, 0.0, 1.0));

          // sluneční odlesk (chytá ho bloom)
          vec3 refl = reflect(-uSunDir, nrm);
          float spec = pow(max(dot(refl, viewDir), 0.0), 140.0) * 1.4;
          col += vec3(spec);

          // pěna na hraně pláže
          float foamBand = smoothstep(0.9, 0.05, abs(depth - 0.30));
          float foamN = vnoise(vWorldPos.xz * 2.6 + vec2(uTime * 0.55, uTime * 0.4));
          float foam = foamBand * smoothstep(0.42, 0.75, foamN) * inside;
          col = mix(col, vec3(1.0), foam * 0.85);

          float alpha = mix(0.93, 0.62, shallow);
          alpha = max(alpha, foam);

          // fog do dálky (ShaderMaterial scene.fog nevidí)
          float dist = length(cameraPosition - vWorldPos);
          float fogF = smoothstep(uFogNear, uFogFar, dist);
          col = mix(col, uFogColor, fogF);
          alpha = mix(alpha, 1.0, fogF * 0.6);

          gl_FragColor = vec4(col, alpha);
        }
      `,
    })

    this.waterMesh = new THREE.Mesh(geo, mat)
    this.waterMesh.position.set(SIZE / 2, waterY, SIZE / 2)
    this.group.add(this.waterMesh)
    this.waterY = waterY
  }

  // ── voxel mraky ──
  _buildClouds() {
    this.clouds = new THREE.Group()
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 })
    for (let i = 0; i < 14; i++) {
      const cloud = new THREE.Group()
      const parts = 3 + Math.floor(this.rng() * 4)
      for (let p = 0; p < parts; p++) {
        const box = new THREE.Mesh(new THREE.BoxGeometry(6 + this.rng() * 8, 1.6, 4 + this.rng() * 6), mat)
        box.position.set((this.rng() - 0.5) * 13, (this.rng() - 0.5) * 0.8, (this.rng() - 0.5) * 10)
        cloud.add(box)
      }
      cloud.position.set(this.rng() * 600 - 170, 42 + this.rng() * 14, this.rng() * 600 - 170)
      cloud.userData.speed = 0.8 + this.rng() * 0.9
      this.clouds.add(cloud)
    }
    this.group.add(this.clouds)
  }

  // ── světlušky / prach ──
  _buildFireflies() {
    const N = 420
    this.fireflyBase = new Float32Array(N * 3)
    this.fireflyPhase = new Float32Array(N)
    const pos = new Float32Array(N * 3)
    for (let i = 0; i < N; i++) {
      const x = this.rng() * SIZE, z = this.rng() * SIZE
      const y = this.terrainHeight(x, z) + 1 + this.rng() * 6
      this.fireflyBase.set([x, y, z], i * 3)
      this.fireflyPhase[i] = this.rng() * Math.PI * 2
      pos.set([x, y, z], i * 3)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    const mat = new THREE.PointsMaterial({
      color: 0xffe9a0, size: 0.14, transparent: true, opacity: 0.8,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    })
    this.fireflies = new THREE.Points(geo, mat)
    this.group.add(this.fireflies)
  }

  update(dt) {
    this.time += dt
    this.waterUniforms.uTime.value = this.time

    for (const cloud of this.clouds.children) {
      cloud.position.x += cloud.userData.speed * dt
      if (cloud.position.x > 450) cloud.position.x = -170
    }

    const pos = this.fireflies.geometry.attributes.position
    for (let i = 0; i < this.fireflyPhase.length; i++) {
      const p = this.fireflyPhase[i], t = this.time
      pos.array[i * 3 + 0] = this.fireflyBase[i * 3 + 0] + Math.sin(t * 0.7 + p) * 0.8
      pos.array[i * 3 + 1] = this.fireflyBase[i * 3 + 1] + Math.sin(t * 1.1 + p * 2.0) * 0.5
      pos.array[i * 3 + 2] = this.fireflyBase[i * 3 + 2] + Math.cos(t * 0.6 + p) * 0.8
    }
    pos.needsUpdate = true
    this.fireflies.material.opacity = 0.55 + Math.sin(this.time * 1.8) * 0.25

    // sopka: pulzující žár + stoupající kouř
    if (this.lavaCubes) {
      const glow = 1.5 + Math.sin(this.time * 2.4) * 0.35 + Math.sin(this.time * 7) * 0.1
      this.lavaMat.emissiveIntensity = glow
      this.lavaLight.intensity = 22 + Math.sin(this.time * 2.4) * 6
      const sp = this.smoke.geometry.attributes.position
      const cx = this.volcanoPos.x, cz = this.volcanoPos.z
      for (let i = 0; i < this.smokeY.length; i++) {
        this.smokeY[i] += dt * (1.5 + (i % 3) * 0.35)
        if (this.smokeY[i] > this.smokeMaxH) { // recyklace u dna
          this.smokeY[i] = 0
          sp.array[i * 3 + 0] = cx + Math.sin(i * 12.9898) * 0.7
          sp.array[i * 3 + 2] = cz + Math.cos(i * 7.233) * 0.7
        }
        const spread = 1 + this.smokeY[i] * 0.14 // rozšiřuje se s výškou
        sp.array[i * 3 + 1] = this.smokeBaseY + this.smokeY[i]
        sp.array[i * 3 + 0] += Math.sin(this.time * 0.5 + i) * dt * 0.28 * spread
        sp.array[i * 3 + 2] += Math.cos(this.time * 0.45 + i) * dt * 0.28 * spread
      }
      sp.needsUpdate = true
    }
  }

  dispose() {
    this.scene.remove(this.group)
    this.group.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose()
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
        for (const m of mats) {
          for (const key of Object.keys(m)) {
            if (m[key] && m[key].isTexture) m[key].dispose()
          }
          m.dispose()
        }
      }
    })
  }
}
