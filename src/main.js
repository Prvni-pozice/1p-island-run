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
import { Dinos } from './dinos.js'
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
    this.renderer.toneMappingExposure = 1.05
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
        vec3 hsv2rgb(vec3 c) {
          vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0);
          return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
        }
        void main() {
          vec3 dir = normalize(vWorldPos - cameraPosition);
          float h = dir.y;

          // tropická azurová: sytá v zenitu, světlá tyrkysová u obzoru
          vec3 zenith = vec3(0.07, 0.33, 0.78);
          vec3 horizon = vec3(0.60, 0.84, 0.95);
          vec3 col = mix(horizon, zenith, pow(clamp(h, 0.0, 1.0), 0.5));

          // Miami západ slunce: přechod oranžová → růžová → fialová, pokrývá
          // ~polovinu výhledu (strana slunce) a sahá vysoko po obloze
          vec2 dxz = normalize(dir.xz + vec2(1e-5));
          vec2 sxz = normalize(uSunDir.xz + vec2(1e-5));
          float az = dot(dxz, sxz) * 0.5 + 0.5;
          float sunAz = smoothstep(0.12, 0.72, az);          // ~polovina azimutu
          float height = pow(clamp(1.0 - h, 0.0, 1.0), 1.15); // dosah vysoko
          vec3 mOrange = vec3(1.00, 0.53, 0.26);
          vec3 mPink   = vec3(1.00, 0.40, 0.66);
          vec3 mViolet = vec3(0.54, 0.33, 0.93);
          float hh = clamp(h * 2.1, 0.0, 1.0);
          vec3 miami = mix(mOrange, mPink, smoothstep(0.0, 0.45, hh));
          miami = mix(miami, mViolet, smoothstep(0.4, 1.0, hh));
          col = mix(col, miami, sunAz * height * 0.92);

          // duha na opačné straně než slunce (kolem anti-solárního bodu, ~40–42°)
          float ra = degrees(acos(clamp(dot(dir, -uSunDir), -1.0, 1.0)));
          float rt = (ra - 40.0) / 2.2;                       // 0=vnitřní fialová, 1=vnější červená
          float arc = smoothstep(0.0, 0.12, rt) * smoothstep(1.0, 0.86, rt);
          float aboveH = smoothstep(-0.03, 0.12, h);          // jen nad obzorem
          vec3 rainbow = hsv2rgb(vec3((1.0 - clamp(rt, 0.0, 1.0)) * 0.72, 0.85, 1.0));
          col = mix(col, rainbow, arc * aboveH * 0.45);

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

    // silná ambient výplň = odstíněná místa září barvou, ne černotou.
    // Hemisféra osvětluje stinné strany (obloha shora, teplý odraz písku
    // zdola), plochý ambient nadzvedne absolutní černou.
    this.hemi = new THREE.HemisphereLight(0xcfe8ff, 0xcbb191, 2.05)
    this.scene.add(this.hemi)
    this.ambient = new THREE.AmbientLight(0xdce8ff, 0.45)
    this.scene.add(this.ambient)

    // přímé slunce mírnější → menší kontrast, stíny zůstávají čitelné ale měkčí
    this.sun = new THREE.DirectionalLight(0xfff2d6, 1.3)
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
    this.sun.shadow.intensity = 0.45 // mírný stín místo skoro černého (stromy)
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
    this.dinos = new Dinos(this.scene, this.world, mulberry32(seed ^ 0x5eed77), this.player.pos)
    this.goal = new Goal(this.scene, this.world, this.player.pos)
    this.bonusMs = 0
    this.paused = false
  }

  _rebuildRound() {
    this.world.dispose()
    this.animals.dispose()
    this.dinos.dispose()
    this.goal.dispose()
    this.particles.dispose()
    this._buildRound()
  }

  _startRound() {
    this.state = 'playing'
    this.paused = false
    this.startTime = performance.now()
    this.elapsed = 0
    this.bonusMs = 0
    this.audio.init() // user gesture — iOS vyžaduje
    this.ui.beginRun() // vyžádá anti-cheat token (fire-and-forget)
    this.controls.enabled = true
    this.controls.lock()
    this.ui.showPlaying(this.touch)
  }

  _win() {
    this.state = 'won'
    this.elapsed = performance.now() - this.startTime
    const net = Math.max(0, this.elapsed - this.bonusMs)
    this.particles.confetti(this.goal.pos)
    this.audio.fanfare()
    this.controls.enabled = false
    this.controls.unlock()
    // net = zobrazený/uložený čas; raw + počet dinů pro serverové ověření
    this.ui.showWin(net, this.elapsed, this.dinos.collectedCount)
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
        // v louce zní šustění trávy místo kroků
        if (this.stepDistance > (this.world.inMeadow(this.player.pos.x, this.player.pos.z) ? 1.3 : 2.1)) {
          this.stepDistance = 0
          if (this.world.inMeadow(this.player.pos.x, this.player.pos.z)) this.audio.grass()
          else this.audio.step()
        }
      }
      this._prevPlayerXZ = { x: this.player.pos.x, z: this.player.pos.z }
      if (this.player.justJumped) {
        this.player.justJumped = false
        this.audio.jump()
      }

      this.elapsed = performance.now() - this.startTime
      this.ui.updateTimer(Math.max(0, this.elapsed - this.bonusMs))

      if (this.goal.check(this.player.pos, this.player.height)) this._win()
    }

    // kamera
    const eye = this.player.eyePosition
    this.camera.position.copy(eye)
    this.camera.rotation.set(0, 0, 0)
    this.camera.rotateY(this.controls.yaw)
    this.camera.rotateX(this.controls.pitch)

    // svět žije i v menu (voda, mraky, zvířata, beacon)
    this._updateDinoMarkers()

    this.world.update(dt)
    this.animals.update(dt, this.player.pos, () => this.audio.squeak())
    const collectible = this.state === 'playing' && !this.paused
    this.dinos.update(dt, this.player.pos, collectible, dino => {
      this.bonusMs += 10000
      this.audio.bonus()
      this.particles.confetti(dino.pos) // jiskřičky
      this.ui.flashBonus(this.dinos.collectedCount, this.dinos.total)
    })
    this.goal.update(dt)
    this.particles.update(dt)

    this.composer.render()
  }

  // Ukazatel dinosaurů: 🦕 značka nad každým nesebraným dinem; mimo obrazovku
  // se přichytí k okraji (funguje jako šipka). Jen během hry.
  _updateDinoMarkers() {
    const container = document.getElementById('dino-markers')
    const show = this.state === 'playing' && !this.paused
    if (container.style.display !== (show ? 'block' : 'none')) {
      container.style.display = show ? 'block' : 'none'
    }
    if (!show) return
    if (!this._dinoMarkers) this._dinoMarkers = []
    if (!this._markTmp) { this._markTmp = new THREE.Vector3(); this._markFwd = new THREE.Vector3() }

    const W = window.innerWidth, H = window.innerHeight
    const cx = W / 2, cy = H / 2, pad = 36
    const camPos = this.camera.position
    this.camera.getWorldDirection(this._markFwd)
    let mi = 0

    for (const d of this.dinos.list) {
      if (d.collected || !d.group.visible) continue
      let el = this._dinoMarkers[mi]
      if (!el) {
        el = document.createElement('div')
        el.className = 'dino-marker'
        el.innerHTML = '<span class="ic">🦕</span><span class="dist"></span>'
        container.appendChild(el)
        this._dinoMarkers[mi] = el
      }
      el.style.display = 'flex'

      const t = this._markTmp
      t.copy(d.group.position); t.y += 2.4
      const behind = t.clone().sub(camPos).dot(this._markFwd) < 0
      t.project(this.camera)
      let sx = (t.x * 0.5 + 0.5) * W
      let sy = (-t.y * 0.5 + 0.5) * H
      if (behind) { sx = W - sx; sy = H - sy } // za kamerou → obrátit směr k okraji

      const offscreen = behind || sx < pad || sx > W - pad || sy < pad || sy > H - pad
      if (offscreen) {
        let vx = sx - cx, vy = sy - cy
        const len = Math.hypot(vx, vy) || 1
        vx /= len; vy /= len
        const scale = Math.min((cx - pad) / Math.max(Math.abs(vx), 1e-3), (cy - pad) / Math.max(Math.abs(vy), 1e-3))
        sx = cx + vx * scale; sy = cy + vy * scale
      }
      el.style.left = sx + 'px'
      el.style.top = sy + 'px'
      el.classList.toggle('edge', offscreen)
      if (!offscreen) el.querySelector('.dist').textContent = Math.round(camPos.distanceTo(d.group.position)) + ' m'
      mi++
    }
    for (let j = mi; j < this._dinoMarkers.length; j++) this._dinoMarkers[j].style.display = 'none'
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
