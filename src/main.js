// main.js — orchestrace: renderer, osvětlení, obloha, post-processing, game loop.
import * as THREE from 'three'
import { Sky } from 'three/addons/objects/Sky.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js'

import { World, SIZE } from './world.js'
import { Player } from './player.js'
import { Controls, isTouchDevice } from './controls.js'
import { Animals } from './animals.js'
import { Goal } from './goal.js'
import { Particles } from './particles.js'
import { UI } from './ui.js'

function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

class Game {
  constructor() {
    this.touch = isTouchDevice()
    this.state = 'menu' // menu | playing | won
    this.startTime = 0
    this.elapsed = 0

    this._setupRenderer()
    this._setupSceneBase()
    this._setupPost()

    this.controls = new Controls(this.renderer.domElement)
    this.controls.onLockLost = () => {
      if (this.state === 'playing') {
        this.paused = true
        this.ui.showResume()
      }
    }

    this.ui = new UI({
      isTouch: this.touch,
      onStart: () => this._startRound(),
      onReplay: () => { this._rebuildRound(); this._startRound() },
      onResume: () => {
        this.paused = false
        this.ui.hideResume()
        this.controls.lock()
      },
    })

    this._buildRound()

    window.addEventListener('resize', () => this._onResize())
    this.clock = new THREE.Clock()
    this.renderer.setAnimationLoop(() => this._tick())
  }

  _setupRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      antialias: false, // AA řeší SMAA pass
      powerPreference: 'high-performance',
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 0.85
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    document.body.appendChild(this.renderer.domElement)

    this.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 600)
  }

  _setupSceneBase() {
    this.scene = new THREE.Scene()
    this.scene.fog = new THREE.Fog(0xc4ddee, 60, 220)

    // slunce + obloha
    const sunDir = new THREE.Vector3(0.55, 0.62, 0.42).normalize()
    this.sunDir = sunDir

    this.sky = new Sky()
    this.sky.scale.setScalar(2000)
    const su = this.sky.material.uniforms
    su.turbidity.value = 6
    su.rayleigh.value = 1.8
    su.mieCoefficient.value = 0.004
    su.mieDirectionalG.value = 0.85
    su.sunPosition.value.copy(sunDir)
    this.scene.add(this.sky)

    this.hemi = new THREE.HemisphereLight(0xbfe3ff, 0x8b7355, 0.75)
    this.scene.add(this.hemi)

    this.sun = new THREE.DirectionalLight(0xfff2d8, 2.4)
    this.sun.position.copy(sunDir).multiplyScalar(90).add(new THREE.Vector3(SIZE / 2, 0, SIZE / 2))
    this.sun.target.position.set(SIZE / 2, 0, SIZE / 2)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(2048, 2048)
    const d = 52
    this.sun.shadow.camera.left = -d
    this.sun.shadow.camera.right = d
    this.sun.shadow.camera.top = d
    this.sun.shadow.camera.bottom = -d
    this.sun.shadow.camera.near = 20
    this.sun.shadow.camera.far = 190
    this.sun.shadow.bias = -0.0004
    this.sun.shadow.normalBias = 0.03
    this.scene.add(this.sun)
    this.scene.add(this.sun.target)
  }

  _setupPost() {
    this.composer = new EffectComposer(this.renderer)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.38,  // strength
      0.6,   // radius
      0.82,  // threshold — svítí beacon, odlesky vody, logo blok
    )
    this.composer.addPass(this.bloom)
    this.smaa = new SMAAPass(
      window.innerWidth * this.renderer.getPixelRatio(),
      window.innerHeight * this.renderer.getPixelRatio(),
    )
    this.composer.addPass(this.smaa)
  }

  _buildRound() {
    const seed = (Math.random() * 2 ** 31) | 0
    this.world = new World(this.scene, seed)
    this.world.waterUniforms.uSunDir.value.copy(this.sunDir)

    this.player = new Player(this.world)
    this.particles = new Particles(this.scene)
    this.player.onSplash = pos => this.particles.splash(pos)

    this.animals = new Animals(this.scene, this.world, mulberry32(seed ^ 0xabcdef))
    this.goal = new Goal(this.scene, this.world, this.player.pos)
    this.paused = false
  }

  _rebuildRound() {
    this.world.dispose()
    this.animals.dispose()
    this.goal.dispose()
    this.particles.dispose()
    this._buildRound()
  }

  _startRound() {
    this.state = 'playing'
    this.paused = false
    this.startTime = performance.now()
    this.elapsed = 0
    this.controls.enabled = true
    this.controls.lock()
    this.ui.showPlaying(this.touch)
  }

  _win() {
    this.state = 'won'
    this.elapsed = performance.now() - this.startTime
    this.particles.confetti(this.goal.pos)
    this.controls.enabled = false
    this.controls.unlock()
    this.ui.showWin(this.elapsed)
  }

  _tick() {
    const dt = Math.min(this.clock.getDelta(), 0.05)

    if (this.state === 'playing' && !this.paused) {
      const move = this.controls.getMove()
      this.player.update(dt, move, this.controls.yaw, this.controls.jumpHeld)

      this.elapsed = performance.now() - this.startTime
      this.ui.updateTimer(this.elapsed)

      if (this.goal.check(this.player.pos, this.player.height)) this._win()
    }

    // kamera
    const eye = this.player.eyePosition
    this.camera.position.copy(eye)
    this.camera.rotation.set(0, 0, 0)
    this.camera.rotateY(this.controls.yaw)
    this.camera.rotateX(this.controls.pitch)

    // svět žije i v menu (voda, mraky, zvířata, beacon)
    this.world.update(dt)
    this.animals.update(dt, this.player.pos)
    this.goal.update(dt)
    this.particles.update(dt)

    this.composer.render()
  }

  _onResize() {
    const w = window.innerWidth, h = window.innerHeight
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h)
    this.composer.setSize(w, h)
  }
}

new Game()
