// goal.js — cílový blok s logem 1P + světelný beacon viditelný přes ostrov.
// Logo z /assets/1p-logo.png (vyměnitelné bez zásahu do kódu).
import * as THREE from 'three'

function placeholderLogo() {
  const canvas = document.createElement('canvas')
  canvas.width = 128; canvas.height = 128
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#12224e'
  ctx.fillRect(0, 0, 128, 128)
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 64px sans-serif'
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText('1P', 64, 60)
  ctx.fillStyle = '#ffb347'
  ctx.fillRect(28, 96, 72, 8)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export class Goal {
  constructor(scene, world, avoidPos) {
    this.scene = scene
    this.group = new THREE.Group()
    this.time = 0

    // pozice: pevnina, dostatečně daleko od spawnu
    let pos = null
    for (let i = 0; i < 60; i++) {
      const candidate = world.randomLandPosition(1)
      if (!avoidPos || candidate.distanceTo(avoidPos) > 22) { pos = candidate; break }
      pos = candidate // fallback — poslední pokus
    }
    this.pos = new THREE.Vector3(pos.x, pos.y + 0.5, pos.z)

    // blok s logem — emissive, aby ho rozsvítil bloom
    const logoMat = new THREE.MeshStandardMaterial({
      map: placeholderLogo(),
      emissive: 0xffffff,
      emissiveMap: null,
      emissiveIntensity: 0.55,
      roughness: 0.4,
    })
    new THREE.TextureLoader().load(
      '/assets/1p-logo.png',
      tex => {
        tex.colorSpace = THREE.SRGBColorSpace
        logoMat.map.dispose()
        logoMat.map = tex
        logoMat.emissiveMap = tex
        logoMat.needsUpdate = true
      },
      undefined,
      () => {},
    )
    logoMat.emissiveMap = logoMat.map

    this.block = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), logoMat)
    this.block.position.copy(this.pos)
    this.block.castShadow = true
    this.group.add(this.block)

    // beacon — sloup světla do nebe (additive, chytá bloom)
    const beamGeo = new THREE.CylinderGeometry(0.32, 0.62, 70, 12, 1, true)
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0x8fd8ff,
      transparent: true,
      opacity: 0.34,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    this.beam = new THREE.Mesh(beamGeo, beamMat)
    this.beam.position.set(this.pos.x, this.pos.y + 35, this.pos.z)
    this.group.add(this.beam)

    // jemná zář kolem bloku
    this.light = new THREE.PointLight(0x9fdcff, 14, 14)
    this.light.position.set(this.pos.x, this.pos.y + 1.2, this.pos.z)
    this.group.add(this.light)

    scene.add(this.group)
  }

  update(dt) {
    this.time += dt
    this.block.rotation.y += dt * 0.8
    this.beam.rotation.y -= dt * 0.3
    const pulse = 0.30 + Math.sin(this.time * 2.2) * 0.10
    this.beam.material.opacity = pulse
    this.light.intensity = 12 + Math.sin(this.time * 2.2) * 4
    this.block.position.y = this.pos.y + Math.sin(this.time * 1.6) * 0.08
  }

  /** Dotyk hráče: horizontální vzdálenost + vertikální překryv */
  check(playerPos, playerHeight = 1.8) {
    const dx = playerPos.x - this.pos.x
    const dz = playerPos.z - this.pos.z
    const horiz = Math.hypot(dx, dz)
    const vertOverlap = playerPos.y < this.pos.y + 0.9 && playerPos.y + playerHeight > this.pos.y - 0.9
    return horiz < 1.15 && vertOverlap
  }

  dispose() {
    this.scene.remove(this.group)
    this.group.traverse(o => {
      if (o.geometry) o.geometry.dispose()
      if (o.material) {
        if (o.material.map) o.material.map.dispose()
        o.material.dispose()
      }
    })
  }
}
