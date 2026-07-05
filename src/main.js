// main.js — orchestrace: renderer, osvětlení, obloha, post-processing, game loop.
import * as THREE from 'three'
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
import { QualityManager } from './quality.js'
import { AudioFX } from './audio.js'

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

    this.audio = new AudioFX()
    this.stepDistance = 0
    this._prevPlayerXZ = null

    const muteBtn = document.getElementById('mute-btn')
    muteBtn.textContent = this.audio.muted ? '🔇' : '🔊'
    muteBtn.addEventListener('click', () => {
      this.audio.init()
      muteBtn.textContent = this.audio.toggleMute() ? '🔇' : '🔊'
    })

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
    this.renderer.toneMappingExposure = 0.95
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    document.body.appendChild(this.renderer.domElement)

    this.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 2500)
  }

  _setupSceneBase() {
    this.scene = new THREE.Scene()
    this.scene.fog = new THREE.Fog(0xc7dff0, 90, 420)

    // slunce níž nad obzorem — Miami vibe, dlouhé stíny
    const sunDir = new THREE.Vector3(0.62, 0.42, 0.48).normalize()
    this.sunDir = sunDir

    // vlastní sky shader: tropická modř, viditelné slunce, růžovo-fialová
    // strana u obzoru (Miami) — Three.js Sky se přepaloval do bíla
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: { uSunDir: { value: sunDir } },
      vertexShader: /* glsl */`
        varying vec3 vWorldPos;
        void main() {
          vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * viewMatrix * vec4(vWorldPos, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
        uniform vec3 uSunDir;
        varying vec3 vWorldPos;
        void main() {
          vec3 dir = normalize(vWorldPos - cameraPosition);
          float h = dir.y;

          // tropická azurová: sytá v zenitu, světlá tyrkysová u obzoru
          vec3 zenith = vec3(0.07, 0.33, 0.78);
          vec3 horizon = vec3(0.60, 0.84, 0.95);
          vec3 col = mix(horizon, zenith, pow(clamp(h, 0.0, 1.0), 0.5));

          // Miami pás: růžovo-fialová u obzoru na straně slunce
          vec2 dxz = normalize(dir.xz + vec2(1e-5));
          vec2 sxz = normalize(uSunDir.xz + vec2(1e-5));
          float az = dot(dxz, sxz) * 0.5 + 0.5;
          float lowBand = pow(clamp(1.0 - h, 0.0, 1.0), 3.0);
          vec3 pink = vec3(1.0, 0.45, 0.74);
          vec3 viola = vec3(0.55, 0.34, 0.95);
          vec3 miami = mix(pink, viola, clamp(h * 4.0 + 0.15, 0.0, 1.0));
          col = mix(col, miami, smoothstep(0.2, 1.0, az) * lowBand * 0.9);

          // sluneční kotouč + teplá záře kolem
          float s = dot(dir, normalize(uSunDir));
          float glow = pow(max(s, 0.0), 900.0) * 0.9 + pow(max(s, 0.0), 60.0) * 0.28;
          col += vec3(1.0, 0.88, 0.70) * glow;
          col += vec3(1.0, 0.95, 0.85) * smoothstep(0.99955, 0.99985, s) * 2.2;

          // pod obzorem mořský opar
          col = mix(col, vec3(0.72, 0.82, 0.90), smoothstep(0.0, -0.12, h));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    })
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), skyMat)
    this.sky.position.set(SIZE / 2, 0, SIZE / 2)
    this.scene.add(this.sky)

    // silnější ambient výplň = měkčí dojem stínů (stíněná místa nejsou černá)
    this.hemi = new THREE.HemisphereLight(0xbfe3ff, 0x9b8265, 1.1)
    this.scene.add(this.hemi)

    this.sun = new THREE.DirectionalLight(0xfff0d0, 1.8)
    this.sun.position.copy(sunDir).multiplyScalar(140).add(new THREE.Vector3(SIZE / 2, 0, SIZE / 2))
    this.sun.target.position.set(SIZE / 2, 0, SIZE / 2)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(this.touch ? 2048 : 4096, this.touch ? 2048 : 4096)
    const d = SIZE / 2 + 14
    this.sun.shadow.camera.left = -d
    this.sun.shadow.camera.right = d
    this.sun.shadow.camera.top = d
    this.sun.shadow.camera.bottom = -d
    this.sun.shadow.camera.near = 5
    this.sun.shadow.camera.far = 380
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

    this.quality = new QualityManager({
      renderer: this.renderer,
      composer: this.composer,
      bloom: this.bloom,
      smaa: this.smaa,
      isTouch: this.touch,
    })
  }

  _buildRound() {
    const seed = (Math.random() * 2 ** 31) | 0
    this.world = new World(this.scene, seed)
    this.world.waterUniforms.uSunDir.value.copy(this.sunDir)

    this.player = new Player(this.world)
    this.particles = new Particles(this.scene)
    this.player.onSplash = pos => {
      this.particles.splash(pos)
      this.audio.splash()
    }

    this.animals = new Animals(this.scene, this.world, mulberry32(seed ^ 0xabcdef), this.player.pos)
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
    this.audio.init() // user gesture — iOS vyžaduje
    this.ui.beginRun() // vyžádá anti-cheat token (fire-and-forget)
    this.controls.enabled = true
    this.controls.lock()
    this.ui.showPlaying(this.touch)
  }

  _win() {
    this.state = 'won'
    this.elapsed = performance.now() - this.startTime
    this.particles.confetti(this.goal.pos)
    this.audio.fanfare()
    this.controls.enabled = false
    this.controls.unlock()
    this.ui.showWin(this.elapsed)
  }

  _tick() {
    const rawDt = this.clock.getDelta()
    this.quality.update(rawDt)
    const dt = Math.min(rawDt, 0.05)

    if (this.state === 'playing' && !this.paused) {
      const move = this.controls.getMove()
      this.player.update(dt, move, this.controls.yaw, this.controls.jumpHeld)

      // kroky: každé ~2.1 bloku ušlé po zemi
      if (this._prevPlayerXZ && this.player.onGround && !this.player.inWater) {
        this.stepDistance += Math.hypot(
          this.player.pos.x - this._prevPlayerXZ.x,
          this.player.pos.z - this._prevPlayerXZ.z,
        )
        if (this.stepDistance > 2.1) {
          this.stepDistance = 0
          this.audio.step()
        }
      }
      this._prevPlayerXZ = { x: this.player.pos.x, z: this.player.pos.z }
      if (this.player.justJumped) {
        this.player.justJumped = false
        this.audio.jump()
      }

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
    this.animals.update(dt, this.player.pos, () => this.audio.squeak())
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
