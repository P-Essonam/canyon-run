import * as THREE from "three"
import {
  CEILING,
  Canyon,
  WALL_HEIGHT,
  MAX_SPEED,
  hash,
  speedAt,
} from "./canyon"
import { DISCONNECT_GRACE_MS, PLAYER_COLORS } from "../shared/protocol"
import type { Obstacle } from "./canyon"
import type { Sound } from "./audio"
import type { GameState, Phase } from "../shared/protocol"

// The game, on the screen: the 3D canyon, the rockets, collisions and the
// phases (lobby → countdown → flying → over → lobby). Phones only send
// tilt; everything is decided here and sent back through `onState`.

const CHUNK = 30
const STEP = 3
const VIEW_BEHIND = 40
const VIEW_AHEAD = 430
const COUNTDOWN = 3
const OVER_SECONDS = 5
const LOBBY_SPEED = 14
const GRAZE_MARGIN = 1.3
const GRAZE_COOLDOWN_MS = 450

type Callbacks = {
  onState: (state: GameState) => void
  onGraze: (slot: number) => void
}

type Player = {
  slot: number
  connected: boolean
  goneSince: number | null
  ready: boolean
  // Flies in the current game.
  playing: boolean
  alive: boolean
  distance: number
  x: number
  y: number
  r: number
  p: number
  targetR: number
  targetP: number
  lastGraze: number
  rocket: Rocket
}

export class Game {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(68, 1, 0.5, 900)
  private sun: THREE.Sprite
  private canyon = new Canyon(randomSeed())
  private chunks = new Map<number, THREE.Group>()
  private materials: Materials
  private players = new Map<number, Player>()
  private bursts: Array<Burst> = []
  private frame = 0
  private last = performance.now()
  private resize: ResizeObserver

  private phase: Phase = "lobby"
  private phaseTime = 0
  private countdown = COUNTDOWN
  private flightTime = 0
  private d = 0
  private winner: number | null = null
  private seats = 1
  private lastEmit = 0
  private shake = 0
  private focus = new THREE.Vector3()

  constructor(
    private canvas: HTMLCanvasElement,
    private sound: Sound,
    private callbacks: Callbacks
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.outputColorSpace = THREE.SRGBColorSpace

    this.scene.background = skyTexture()
    this.scene.fog = new THREE.Fog("#f0955a", 90, VIEW_AHEAD - 20)
    this.scene.add(new THREE.HemisphereLight("#ffd9b0", "#6e2a1a", 1.4))
    const light = new THREE.DirectionalLight("#ffb27a", 2.6)
    light.position.set(-60, 50, -100)
    this.scene.add(light)
    this.scene.add(light.target)

    this.sun = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: sunTexture(),
        fog: false,
        depthWrite: false,
        transparent: true,
      })
    )
    this.sun.scale.set(150, 150, 1)
    this.scene.add(this.sun)

    this.materials = makeMaterials()
    this.resize = new ResizeObserver(() => this.fit())
    this.resize.observe(canvas)
    this.fit()
    this.frame = requestAnimationFrame(this.tick)
  }

  // --- From the room -----------------------------------------------------

  setPlayers(list: Array<{ slot: number; connected: boolean }>) {
    const now = performance.now()
    const seen = new Set<number>()
    for (const { slot, connected } of list) {
      seen.add(slot)
      let player = this.players.get(slot)
      if (!player) {
        player = this.newPlayer(slot)
        this.players.set(slot, player)
      }
      if (player.connected && !connected) player.goneSince = now
      if (connected) player.goneSince = null
      player.connected = connected
    }
    for (const [slot, player] of this.players) {
      if (seen.has(slot)) continue
      // Gone for good: drop it now, unless it is flying (then it counts as
      // quit when its grace runs out).
      if (player.playing && player.alive) {
        player.connected = false
        player.goneSince ??= now
      } else {
        player.rocket.dispose()
        this.players.delete(slot)
      }
    }
    this.emit()
  }

  ready(slot: number) {
    const player = this.players.get(slot)
    if (!player || player.ready) return
    player.ready = true
    this.emit()
  }

  tilt(slot: number, r: number, p: number) {
    const player = this.players.get(slot)
    if (!player) return
    player.targetR = r
    player.targetP = p
  }

  quit(slot: number) {
    const player = this.players.get(slot)
    if (!player) return
    player.ready = false
    if (player.playing && player.alive) this.crash(player, false)
    this.emit()
  }

  // --- For the HUD -------------------------------------------------------

  // 1 or 2 players. Only between games.
  setSeats(seats: number) {
    if (this.phase !== "lobby") return
    this.seats = seats === 2 ? 2 : 1
    this.emit()
  }

  snapshot(): GameState {
    return {
      phase: this.phase,
      seats: this.seats,
      countdown: Math.ceil(this.countdown),
      distance: Math.floor(this.d),
      players: [...this.players.values()]
        .sort((a, b) => a.slot - b.slot)
        .map((player) => ({
          slot: player.slot,
          connected: player.connected,
          ready: player.ready,
          alive: player.alive,
          distance: Math.floor(player.distance),
        })),
      winner: this.winner,
    }
  }

  dispose() {
    cancelAnimationFrame(this.frame)
    this.resize.disconnect()
    for (const chunk of this.chunks.values()) disposeGroup(chunk)
    for (const player of this.players.values()) player.rocket.dispose()
    for (const burst of this.bursts) burst.dispose()
    this.renderer.dispose()
  }

  // --- The loop ----------------------------------------------------------

  private tick = (now: number) => {
    this.frame = requestAnimationFrame(this.tick)
    const dt = Math.min(0.05, (now - this.last) / 1000)
    this.last = now
    this.phaseTime += dt
    this.step(dt, now)
    this.updateChunks()
    this.updateCamera(dt)
    for (const player of this.players.values()) {
      player.rocket.update(dt, player.playing && player.alive && this.phase !== "lobby")
    }
    this.bursts = this.bursts.filter((burst) => burst.update(dt))
    this.renderer.render(this.scene, this.camera)
    if (this.phase === "flying" && now - this.lastEmit > 500) this.emit()
  }

  private step(dt: number, now: number) {
    switch (this.phase) {
      case "lobby": {
        this.d += LOBBY_SPEED * dt
        this.sound.setEngine(0.08)
        const present = [...this.players.values()].filter((p) => p.connected)
        if (present.length > 0 && present.every((p) => p.ready)) {
          this.startCountdown()
        }
        break
      }
      case "countdown": {
        const before = Math.ceil(this.countdown)
        this.countdown -= dt
        const after = Math.ceil(this.countdown)
        if (after !== before && after > 0) {
          this.sound.beep()
          this.emit()
        }
        for (const player of this.players.values()) this.steer(player, dt, true)
        if (this.countdown <= 0) this.startFlight()
        break
      }
      case "flying": {
        this.flightTime += dt
        const speed = speedAt(this.flightTime)
        this.d += speed * dt
        this.sound.setEngine(0.35 + 0.65 * (speed / MAX_SPEED))
        for (const player of this.players.values()) {
          if (!player.playing || !player.alive) continue
          if (player.goneSince !== null && now - player.goneSince > DISCONNECT_GRACE_MS) {
            this.crash(player, false)
            continue
          }
          this.steer(player, dt, false, speed)
          player.distance = this.d
          const clear = this.canyon.clearance(this.d, player.x, player.y)
          if (clear < 0) {
            this.crash(player, true)
          } else if (clear < GRAZE_MARGIN && now - player.lastGraze > GRAZE_COOLDOWN_MS) {
            player.lastGraze = now
            this.sound.whoosh()
            this.callbacks.onGraze(player.slot)
          }
        }
        if (![...this.players.values()].some((p) => p.playing && p.alive)) {
          this.endGame()
        }
        break
      }
      case "over": {
        this.sound.setEngine(0)
        if (this.phaseTime > OVER_SECONDS) this.toLobby()
        break
      }
    }
  }

  private steer(player: Player, dt: number, parked: boolean, speed = 24) {
    // Quick to follow the phone, so steering feels direct: just enough
    // smoothing to hide the gaps between network messages.
    const ease = 1 - Math.exp(-dt * 30)
    player.r += (player.targetR - player.r) * ease
    player.p += (player.targetP - player.p) * ease
    if (parked) {
      player.rocket.place(player.x, player.y, -this.d, player.r, player.p)
      return
    }
    const lateral = 16 * (0.85 + (speed / MAX_SPEED) * 0.5)
    player.x = this.canyon.clampX(this.d, player.x + player.r * lateral * dt)
    // Up and down as quick as left and right.
    player.y = this.canyon.clampY(player.y + player.p * lateral * 0.9 * dt)
    player.rocket.place(player.x, player.y, -this.d, player.r, player.p)
  }

  private startCountdown() {
    this.setPhase("countdown")
    this.countdown = COUNTDOWN
    this.winner = null
    this.flightTime = 0
    this.canyon = new Canyon(randomSeed())
    for (const chunk of this.chunks.values()) disposeGroup(chunk)
    this.chunks.clear()
    this.d = 0
    const flying = [...this.players.values()].filter((p) => p.connected && p.ready)
    for (const player of this.players.values()) {
      const index = flying.indexOf(player)
      player.playing = index !== -1
      player.alive = player.playing
      player.distance = 0
      player.ready = false
      player.r = player.p = player.targetR = player.targetP = 0
      player.x = this.canyon.centerX(0) + (flying.length > 1 ? (index === 0 ? -3 : 3) : 0)
      player.y = 8
      player.rocket.group.visible = player.playing
      player.rocket.place(player.x, player.y, 0, 0, 0)
    }
    this.sound.beep()
    this.emit()
  }

  private startFlight() {
    this.setPhase("flying")
    this.sound.beep(true)
    this.emit()
  }

  private crash(player: Player, explode: boolean) {
    player.alive = false
    player.distance = this.d
    player.rocket.group.visible = false
    const at = player.rocket.group.position.clone()
    if (explode) {
      this.bursts.push(new Burst(this.scene, at, PLAYER_COLORS[player.slot] ?? "#fff"))
      this.sound.explosion()
      this.shake = 1
    } else {
      this.bursts.push(new Burst(this.scene, at, "#ffffff", 0.35))
    }
    this.emit()
  }

  private endGame() {
    const played = [...this.players.values()].filter((p) => p.playing)
    if (played.length > 1) {
      const sorted = [...played].sort((a, b) => b.distance - a.distance)
      const [first, second] = sorted
      this.winner =
        first && second && Math.floor(first.distance) > Math.floor(second.distance)
          ? first.slot
          : null
    }
    this.setPhase("over")
    this.emit()
  }

  private toLobby() {
    this.setPhase("lobby")
    for (const player of this.players.values()) {
      player.playing = false
      player.rocket.group.visible = false
    }
    // Keep the same canyon behind the lobby, cruising on from here.
    this.emit()
  }

  private setPhase(phase: Phase) {
    this.phase = phase
    this.phaseTime = 0
  }

  private emit() {
    this.lastEmit = performance.now()
    this.callbacks.onState(this.snapshot())
  }

  private newPlayer(slot: number): Player {
    const rocket = new Rocket(PLAYER_COLORS[slot] ?? "#ffffff")
    rocket.group.visible = false
    this.scene.add(rocket.group)
    return {
      slot,
      connected: true,
      goneSince: null,
      ready: false,
      playing: false,
      alive: false,
      distance: 0,
      x: 0,
      y: 8,
      r: 0,
      p: 0,
      targetR: 0,
      targetP: 0,
      lastGraze: 0,
      rocket,
    }
  }

  // --- Camera and world --------------------------------------------------

  private updateCamera(dt: number) {
    const flying = [...this.players.values()].filter(
      (p) => p.playing && (p.alive || this.phase === "over")
    )
    const target = new THREE.Vector3()
    if (this.phase === "lobby" || flying.length === 0) {
      const ahead = this.d + 30
      target.set(this.canyon.centerX(ahead), 11, -ahead)
    } else {
      const alive = flying.filter((p) => p.alive)
      const list = alive.length > 0 ? alive : flying
      for (const p of list) target.add(new THREE.Vector3(p.x, p.y, -this.d))
      target.divideScalar(list.length)
    }
    this.focus.lerp(target, 1 - Math.exp(-dt * 10))
    const behind = this.phase === "lobby" ? 0 : 11
    const desired = new THREE.Vector3(
      this.focus.x * 0.85 + this.canyon.centerX(this.d - behind) * 0.15,
      this.focus.y + 3.4,
      -this.d + behind
    )
    this.camera.position.lerp(desired, 1 - Math.exp(-dt * 8))
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 1.6)
      const s = this.shake * 0.8
      this.camera.position.x += (Math.random() - 0.5) * s
      this.camera.position.y += (Math.random() - 0.5) * s
    }
    const lookAhead = this.d + 28
    this.camera.lookAt(
      this.focus.x * 0.6 + this.canyon.centerX(lookAhead) * 0.4,
      this.focus.y + 0.6,
      -lookAhead
    )
    this.sun.position.set(this.camera.position.x - 90, 70, this.camera.position.z - 600)
  }

  private updateChunks() {
    const first = Math.floor((this.d - VIEW_BEHIND) / CHUNK)
    const last = Math.floor((this.d + VIEW_AHEAD) / CHUNK)
    for (const [index, group] of this.chunks) {
      if (index < first || index > last) {
        disposeGroup(group)
        this.scene.remove(group)
        this.chunks.delete(index)
      }
    }
    // At most two new chunks a frame, to keep frames smooth.
    let built = 0
    for (let index = Math.max(0, first); index <= last && built < 2; index++) {
      if (this.chunks.has(index)) continue
      const group = buildChunk(this.canyon, index, this.materials)
      this.scene.add(group)
      this.chunks.set(index, group)
      built++
    }
  }

  private fit() {
    const width = this.canvas.clientWidth
    const height = this.canvas.clientHeight
    if (!width || !height) return
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
  }
}

// --- The canyon's meshes ---------------------------------------------------

type Materials = {
  rock: THREE.MeshStandardMaterial
  glow: THREE.MeshStandardMaterial
}

function makeMaterials(): Materials {
  return {
    rock: new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 0.95,
      metalness: 0,
    }),
    // The ring around a gate's hole, so it reads from far away.
    glow: new THREE.MeshStandardMaterial({
      color: "#ffd27a",
      emissive: "#ff9a3c",
      emissiveIntensity: 1.4,
      roughness: 0.4,
    }),
  }
}

// Cliff profile: heights of each row and how far it steps back.
const ROWS = [0, 3, 8, 14, 21, 29, 37, WALL_HEIGHT, WALL_HEIGHT]
const BACK = [0, 0.8, 2.4, 3.2, 5.6, 6.6, 9, 11, 60]
const STRATA = ["#7a2f1c", "#a8442a", "#c25a32", "#d4733f", "#b54e2d", "#de8a4e", "#c96a3a", "#e8a566"]
const SAND = ["#d99a5e", "#cf8e55", "#e0a86c"]

function buildChunk(canyon: Canyon, index: number, materials: Materials) {
  const group = new THREE.Group()
  const samples: Array<number> = []
  for (let d = index * CHUNK; d <= (index + 1) * CHUNK + 0.001; d += STEP) samples.push(d)

  const positions: Array<number> = []
  const colors: Array<number> = []
  const color = new THREE.Color()
  const seed = canyon.seed

  const vertex = (side: number, d: number, row: number) => {
    const k = Math.round(d / STEP)
    const jitter = (hash(seed, k * 31 + row * 7 + (side > 0 ? 3 : 0)) - 0.5) * 2.2
    const back = (BACK[row] ?? 0) + (row > 0 && row < ROWS.length - 1 ? jitter : 0)
    const x = canyon.centerX(d) + side * (canyon.width(d) / 2 + back)
    const y = (ROWS[row] ?? 0) + (row > 0 && row < ROWS.length - 2 ? jitter * 0.6 : 0)
    return [x, y, -d] as const
  }

  const quad = (
    a: readonly number[],
    b: readonly number[],
    c: readonly number[],
    e: readonly number[],
    hex: string,
    k: number
  ) => {
    color.set(hex)
    const shade = 0.88 + hash(seed, k) * 0.24
    color.multiplyScalar(shade)
    for (const v of [a, b, c, a, c, e]) {
      positions.push(v[0]!, v[1]!, v[2]!)
      colors.push(color.r, color.g, color.b)
    }
  }

  for (const side of [-1, 1]) {
    for (let i = 0; i < samples.length - 1; i++) {
      const d0 = samples[i]!
      const d1 = samples[i + 1]!
      const k = Math.round(d0 / STEP)
      for (let row = 0; row < ROWS.length - 1; row++) {
        const a = vertex(side, d0, row)
        const b = vertex(side, d1, row)
        const c = vertex(side, d1, row + 1)
        const e = vertex(side, d0, row + 1)
        const hex =
          row === ROWS.length - 2 ? "#e9b27a" : (STRATA[(row + (k >> 3)) % STRATA.length] ?? "#c25a32")
        // Keep faces pointing into the canyon.
        if (side < 0) quad(a, b, c, e, hex, k * 13 + row)
        else quad(b, a, e, c, hex, k * 13 + row)
      }
    }
  }

  // The canyon floor, in strips across.
  const COLUMNS = 5
  for (let i = 0; i < samples.length - 1; i++) {
    const d0 = samples[i]!
    const d1 = samples[i + 1]!
    const k = Math.round(d0 / STEP)
    const at = (d: number, column: number) => {
      const kk = Math.round(d / STEP)
      const half = canyon.width(d) / 2
      const x = canyon.centerX(d) - half + (2 * half * column) / COLUMNS
      const y = column === 0 || column === COLUMNS ? 0 : hash(seed, kk * 17 + column) * 0.5 - 0.2
      return [x, y, -d] as const
    }
    for (let column = 0; column < COLUMNS; column++) {
      quad(
        at(d0, column + 1),
        at(d1, column + 1),
        at(d1, column),
        at(d0, column),
        SAND[(k + column) % SAND.length] ?? "#d99a5e",
        k * 5 + column + 999
      )
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3))
  geometry.computeVertexNormals()
  group.add(new THREE.Mesh(geometry, materials.rock))

  for (const obstacle of canyon.obstaclesBetween(index * CHUNK, (index + 1) * CHUNK)) {
    group.add(buildObstacle(canyon, obstacle, materials))
  }
  return group
}

function buildObstacle(canyon: Canyon, obstacle: Obstacle, materials: Materials) {
  const seed = canyon.seed
  const z = -obstacle.d
  const center = canyon.centerX(obstacle.d)
  // Wide enough to sink into both cliffs.
  const span = canyon.width(obstacle.d) + 26
  const rock = (geometry: THREE.BufferGeometry, hex: string) =>
    new THREE.Mesh(tinted(geometry, hex, seed), materials.rock)

  switch (obstacle.kind) {
    case "pillar": {
      const height = WALL_HEIGHT + 6
      const pillar = rock(
        new THREE.CylinderGeometry(obstacle.radius * 0.8, obstacle.radius * 1.15, height, 7, 5),
        "#a8442a"
      )
      pillar.position.set(obstacle.x, height / 2 - 1, z)
      return pillar
    }
    case "arch": {
      const height = WALL_HEIGHT - obstacle.bottom + 2
      const arch = rock(new THREE.BoxGeometry(span, height, obstacle.depth, 8, 3, 1), "#b54e2d")
      arch.position.set(center, obstacle.bottom + height / 2, z)
      return arch
    }
    case "ridge": {
      const height = obstacle.top + 1
      const ridge = rock(new THREE.BoxGeometry(span, height, obstacle.depth, 10, 3, 1), "#8e3a22")
      ridge.position.set(center, height / 2 - 1, z)
      return ridge
    }
    case "blade": {
      // From the edge to well inside the cliff it grows from.
      const outer = center + obstacle.side * (canyon.width(obstacle.d) / 2 + 13)
      const width = Math.abs(outer - obstacle.edge)
      const height = WALL_HEIGHT + 4
      const blade = rock(new THREE.BoxGeometry(width, height, obstacle.depth, 4, 6, 1), "#c0623a")
      blade.position.set((outer + obstacle.edge) / 2, height / 2 - 1, z)
      return blade
    }
    case "gate": {
      const top = WALL_HEIGHT + 2
      const shape = new THREE.Shape()
      shape.moveTo(-span / 2, -1)
      shape.lineTo(span / 2, -1)
      shape.lineTo(span / 2, top)
      shape.lineTo(-span / 2, top)
      shape.closePath()
      const hole = new THREE.Path()
      hole.absarc(obstacle.x - center, obstacle.y, obstacle.hole, 0, Math.PI * 2, true)
      shape.holes.push(hole)
      const wall = new THREE.ExtrudeGeometry(shape, {
        depth: obstacle.depth,
        bevelEnabled: false,
        curveSegments: 20,
      })
      wall.translate(0, 0, -obstacle.depth / 2)
      const gate = new THREE.Group()
      const mesh = new THREE.Mesh(tinted(wall, "#a64a2b", seed, false), materials.rock)
      mesh.position.set(center, 0, z)
      gate.add(mesh)
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(obstacle.hole, 0.35, 8, 40),
        materials.glow
      )
      ring.position.set(obstacle.x, obstacle.y, z + obstacle.depth / 2 + 0.1)
      gate.add(ring)
      return gate
    }
  }
}

// A geometry with jagged vertices and per-face rock colors. `rough: false`
// keeps it flat and one color: for a shape cut in long thin triangles (a
// wall with a hole), where jagged faces would show as streaks.
function tinted(source: THREE.BufferGeometry, hex: string, seed: number, rough = true) {
  const geometry = source.index ? source.toNonIndexed() : source
  if (geometry !== source) source.dispose()
  const position = geometry.getAttribute("position") as THREE.BufferAttribute
  for (let i = 0; rough && i < position.count; i++) {
    const key = Math.round(position.getX(i) * 10) * 73856093 ^ Math.round(position.getY(i) * 10) * 19349663 ^ Math.round(position.getZ(i) * 10) * 83492791
    const n = hash(seed, key) - 0.5
    position.setXYZ(i, position.getX(i) + n * 0.5, position.getY(i) + n * 0.3, position.getZ(i) + n * 0.5)
  }
  const colors: Array<number> = []
  const color = new THREE.Color()
  for (let face = 0; face < position.count / 3; face++) {
    color.set(hex).multiplyScalar(rough ? 0.8 + hash(seed, face * 11 + 5) * 0.4 : 1)
    for (let v = 0; v < 3; v++) colors.push(color.r, color.g, color.b)
  }
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3))
  geometry.computeVertexNormals()
  return geometry
}

function disposeGroup(group: THREE.Group) {
  group.traverse((object) => {
    if (object instanceof THREE.Mesh) object.geometry.dispose()
  })
  group.removeFromParent()
}

// --- The rocket --------------------------------------------------------------

class Rocket {
  group = new THREE.Group()
  private body = new THREE.Group()
  private flame: THREE.Mesh
  private trail: Trail

  constructor(color: string) {
    const white = new THREE.MeshStandardMaterial({ color: "#f4eee6", flatShading: true, roughness: 0.5 })
    const paint = new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.4, emissive: color, emissiveIntensity: 0.25 })
    const dark = new THREE.MeshStandardMaterial({ color: "#2a2230", roughness: 0.6 })

    const hull = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.46, 2.4, 10), white)
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.1, 10), paint)
    nose.position.y = 1.75
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.47, 0.47, 0.25, 10), paint)
    band.position.y = 0.4
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.38, 0.35, 10), dark)
    nozzle.position.y = -1.35
    this.body.add(hull, nose, band, nozzle)
    for (let i = 0; i < 4; i++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.75, 0.6), paint)
      const angle = (i * Math.PI) / 2 + Math.PI / 4
      fin.position.set(Math.cos(angle) * 0.6, -0.9, Math.sin(angle) * 0.6)
      fin.rotation.y = -angle
      this.body.add(fin)
    }
    this.flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.34, 1.8, 10),
      new THREE.MeshBasicMaterial({ color: "#ffb347", transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })
    )
    this.flame.rotation.x = Math.PI
    this.flame.position.y = -2.4
    this.body.add(this.flame)
    // Built along +y; point the nose at -z.
    this.body.rotation.x = -Math.PI / 2
    this.group.add(this.body)
    this.trail = new Trail(color)
  }

  place(x: number, y: number, z: number, r: number, p: number) {
    this.group.position.set(x, y, z)
    this.group.rotation.set(p * 0.4, 0, -r * 0.9)
  }

  update(dt: number, burning: boolean) {
    const flicker = 0.85 + Math.random() * 0.3
    this.flame.scale.set(flicker, flicker * (burning ? 1.3 : 0.6), flicker)
    if (!this.trail.points.parent && this.group.parent) this.group.parent.add(this.trail.points)
    const tail = new THREE.Vector3(0, 0, 1.9).applyEuler(this.group.rotation).add(this.group.position)
    this.trail.update(dt, burning && this.group.visible ? tail : null)
  }

  dispose() {
    this.group.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose()
        ;(object.material as THREE.Material).dispose()
      }
    })
    this.trail.dispose()
    this.group.removeFromParent()
  }
}

// Exhaust puffs left behind in the air.
// A soft round dot, so particles read as glow and not as squares.
let glowTexture: THREE.Texture | null = null
function glow() {
  if (glowTexture) return glowTexture
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = 64
  const context = canvas.getContext("2d")!
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32)
  gradient.addColorStop(0, "rgba(255,255,255,1)")
  gradient.addColorStop(0.35, "rgba(255,255,255,0.5)")
  gradient.addColorStop(1, "rgba(255,255,255,0)")
  context.fillStyle = gradient
  context.fillRect(0, 0, 64, 64)
  glowTexture = new THREE.CanvasTexture(canvas)
  return glowTexture
}

// The exhaust trail: glowing puffs that cool from flame to smoke and fade.
const TRAIL_LIFE = 0.7

class Trail {
  points: THREE.Points
  private ages: Float32Array
  private count = 120
  private next = 0
  private hot = new THREE.Color("#ffd28a")
  private cool: THREE.Color

  constructor(color: string) {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(this.count * 3), 3))
    geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(this.count * 3), 3))
    this.ages = new Float32Array(this.count).fill(99)
    this.cool = new THREE.Color(color)
    const material = new THREE.PointsMaterial({
      size: 0.7,
      map: glow(),
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    this.points = new THREE.Points(geometry, material)
    this.points.frustumCulled = false
  }

  update(dt: number, emitAt: THREE.Vector3 | null) {
    const position = this.points.geometry.getAttribute("position") as THREE.BufferAttribute
    const colors = this.points.geometry.getAttribute("color") as THREE.BufferAttribute
    const tint = new THREE.Color()
    if (emitAt) {
      for (let n = 0; n < 2; n++) {
        const i = this.next
        this.next = (this.next + 1) % this.count
        this.ages[i] = n * 0.02
        position.setXYZ(i, emitAt.x + (Math.random() - 0.5) * 0.25, emitAt.y + (Math.random() - 0.5) * 0.25, emitAt.z + n * 0.4)
      }
    }
    for (let i = 0; i < this.count; i++) {
      this.ages[i]! += dt
      const t = this.ages[i]! / TRAIL_LIFE
      if (t >= 1) {
        position.setXYZ(i, 0, -9999, 0)
        continue
      }
      // Additive blending: darker means more transparent.
      tint.copy(this.hot).lerp(this.cool, Math.min(1, t * 1.6)).multiplyScalar((1 - t) * (1 - t) * 0.8)
      colors.setXYZ(i, tint.r, tint.g, tint.b)
    }
    position.needsUpdate = true
    colors.needsUpdate = true
  }

  dispose() {
    this.points.geometry.dispose()
    ;(this.points.material as THREE.Material).dispose()
    this.points.removeFromParent()
  }
}

// An explosion: sparks flying out, then fading.
class Burst {
  private points: THREE.Points
  private velocities: Float32Array
  private age = 0
  private light: THREE.PointLight

  constructor(private scene: THREE.Scene, at: THREE.Vector3, color: string, scale = 1) {
    const count = Math.round(180 * scale)
    const positions = new Float32Array(count * 3)
    this.velocities = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      positions.set([at.x, at.y, at.z], i * 3)
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5)
        .normalize()
        .multiplyScalar((6 + Math.random() * 16) * scale)
      this.velocities.set([v.x, v.y, v.z], i * 3)
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3))
    this.points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        color: new THREE.Color(color).lerp(new THREE.Color("#ffb347"), 0.5),
        size: 1.1,
        map: glow(),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    )
    this.light = new THREE.PointLight("#ffaa55", 60 * scale, 40)
    this.light.position.copy(at)
    scene.add(this.points, this.light)
  }

  update(dt: number) {
    this.age += dt
    const position = this.points.geometry.getAttribute("position") as THREE.BufferAttribute
    for (let i = 0; i < position.count; i++) {
      this.velocities[i * 3 + 1]! -= 9 * dt
      position.setXYZ(
        i,
        position.getX(i) + this.velocities[i * 3]! * dt,
        position.getY(i) + this.velocities[i * 3 + 1]! * dt,
        position.getZ(i) + this.velocities[i * 3 + 2]! * dt
      )
    }
    position.needsUpdate = true
    const material = this.points.material as THREE.PointsMaterial
    material.opacity = Math.max(0, 1 - this.age / 1.6)
    this.light.intensity *= 0.9
    if (this.age > 1.6) {
      this.dispose()
      return false
    }
    return true
  }

  dispose() {
    this.points.geometry.dispose()
    ;(this.points.material as THREE.Material).dispose()
    this.scene.remove(this.points, this.light)
  }
}

// --- Sky -----------------------------------------------------------------

function skyTexture() {
  const canvas = document.createElement("canvas")
  canvas.width = 4
  canvas.height = 256
  const context = canvas.getContext("2d")!
  const gradient = context.createLinearGradient(0, 0, 0, 256)
  gradient.addColorStop(0, "#2a1c4f")
  gradient.addColorStop(0.45, "#a2457a")
  gradient.addColorStop(0.75, "#f0955a")
  gradient.addColorStop(1, "#ffd08a")
  context.fillStyle = gradient
  context.fillRect(0, 0, 4, 256)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function sunTexture() {
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = 128
  const context = canvas.getContext("2d")!
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64)
  gradient.addColorStop(0, "rgba(255,245,215,1)")
  gradient.addColorStop(0.25, "rgba(255,214,150,0.95)")
  gradient.addColorStop(0.5, "rgba(255,160,90,0.35)")
  gradient.addColorStop(1, "rgba(255,140,80,0)")
  context.fillStyle = gradient
  context.fillRect(0, 0, 128, 128)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function randomSeed() {
  return Math.floor(Math.random() * 2 ** 31)
}
