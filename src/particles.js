// particles.js — jednorázové particle bursty: šplouchnutí vody a konfety v cíli.
import * as THREE from 'three'

class Burst {
  constructor(scene, { count, pos, colorFn, velFn, life, size, gravity, blending }) {
    this.scene = scene
    this.life = life
    this.age = 0
    this.gravity = gravity

    const positions = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)
    this.vels = new Float32Array(count * 3)

    const c = new THREE.Color()
    for (let i = 0; i < count; i++) {
      positions.set([pos.x, pos.y, pos.z], i * 3)
      const v = velFn()
      this.vels.set([v.x, v.y, v.z], i * 3)
      c.set(colorFn())
      colors.set([c.r, c.g, c.b], i * 3)
    }

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    this.mat = new THREE.PointsMaterial({
      size, vertexColors: true, transparent: true, opacity: 1,
      depthWrite: false, blending: blending || THREE.NormalBlending, sizeAttenuation: true,
    })
    this.points = new THREE.Points(geo, this.mat)
    scene.add(this.points)
  }

  /** @returns false pokud burst skončil */
  update(dt) {
    this.age += dt
    if (this.age >= this.life) {
      this.scene.remove(this.points)
      this.points.geometry.dispose()
      this.mat.dispose()
      return false
    }
    const pos = this.points.geometry.attributes.position
    for (let i = 0; i < pos.count; i++) {
      this.vels[i * 3 + 1] -= this.gravity * dt
      pos.array[i * 3 + 0] += this.vels[i * 3 + 0] * dt
      pos.array[i * 3 + 1] += this.vels[i * 3 + 1] * dt
      pos.array[i * 3 + 2] += this.vels[i * 3 + 2] * dt
    }
    pos.needsUpdate = true
    this.mat.opacity = 1 - (this.age / this.life) ** 2
    return true
  }
}

export class Particles {
  constructor(scene) {
    this.scene = scene
    this.bursts = []
  }

  splash(pos) {
    this.bursts.push(new Burst(this.scene, {
      count: 34, pos, life: 0.9, size: 0.1, gravity: 14,
      blending: THREE.AdditiveBlending,
      colorFn: () => (Math.random() < 0.6 ? '#bfe9ff' : '#ffffff'),
      velFn: () => {
        const a = Math.random() * Math.PI * 2
        const r = 0.6 + Math.random() * 1.8
        return { x: Math.cos(a) * r, y: 2.4 + Math.random() * 2.6, z: Math.sin(a) * r }
      },
    }))
  }

  confetti(pos) {
    this.bursts.push(new Burst(this.scene, {
      count: 140, pos: { x: pos.x, y: pos.y + 1.4, z: pos.z }, life: 2.6, size: 0.13, gravity: 5,
      colorFn: () => `hsl(${Math.floor(Math.random() * 360)}, 90%, 62%)`,
      velFn: () => {
        const a = Math.random() * Math.PI * 2
        const r = 1 + Math.random() * 3
        return { x: Math.cos(a) * r, y: 3 + Math.random() * 4.5, z: Math.sin(a) * r }
      },
    }))
  }

  update(dt) {
    this.bursts = this.bursts.filter(b => b.update(dt))
  }

  dispose() {
    for (const b of this.bursts) {
      this.scene.remove(b.points)
      b.points.geometry.dispose()
      b.mat.dispose()
    }
    this.bursts = []
  }
}
