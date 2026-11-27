// The canyon as numbers: where its middle is, how wide it is and what
// stands in it, at any distance `d` (meters) from the start. The rocket
// flies toward -z, so world z = -d. Seeded, so each game gets its own
// canyon while rendering and collisions agree.

import { MAX_SPEED } from "../shared/protocol"

export { MAX_SPEED }
export const WALL_HEIGHT = 46
export const CEILING = 28
export const FLOOR = 0.6
export const ROCKET_RADIUS = 0.9

// The first stretch is straight and wide, so a first try always lasts.
const EASY_UNTIL = 260
const OBSTACLES_FROM = 320
// One obstacle at most per slot of this many meters, placed somewhere in
// its first OBSTACLE_JITTER meters: two in a row are always at least
// 80 m apart, about a second at top speed, time to line up the next one.
const OBSTACLE_SPACING = 110
const OBSTACLE_JITTER = 30

export type Obstacle =
  | { kind: "pillar"; d: number; x: number; radius: number }
  // An arch across the canyon: fly under its bottom.
  | { kind: "arch"; d: number; bottom: number; depth: number }
  // A low wall across the canyon: fly over its top.
  | { kind: "ridge"; d: number; top: number; depth: number }
  // A wall from one side (side -1: the left, 1: the right) to `edge`:
  // fly past it on the other side.
  | { kind: "blade"; d: number; side: -1 | 1; edge: number; depth: number }
  // A wall across the canyon with a round hole: fly through it.
  | { kind: "gate"; d: number; x: number; y: number; hole: number; depth: number }

export type ObstacleKind = Obstacle["kind"]

// New kinds of obstacles show up as the rocket goes further: the distance
// each one starts at, and how often it comes up once it has.
const KINDS: Array<{ kind: ObstacleKind; from: number; weight: number }> = [
  { kind: "pillar", from: 0, weight: 3 },
  { kind: "arch", from: 0, weight: 2 },
  { kind: "ridge", from: 600, weight: 2 },
  { kind: "blade", from: 900, weight: 2.5 },
  { kind: "gate", from: 10_000, weight: 2 },
]

// The kinds of obstacles met at distance d.
export function kindsAt(d: number) {
  return KINDS.filter((entry) => d >= entry.from).map((entry) => entry.kind)
}

export function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// A hash of (seed, n) in [0, 1), for per-segment randomness.
export function hash(seed: number, n: number) {
  let h = (seed ^ Math.imul(n, 0x9e3779b1)) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

export class Canyon {
  private phases: Array<number>
  private obstacleCache = new Map<number, Obstacle | null>()

  constructor(readonly seed: number) {
    const random = mulberry32(seed)
    this.phases = Array.from({ length: 6 }, () => random() * Math.PI * 2)
  }

  // 0 at the start, 1 once the canyon is at full difficulty.
  private ramp(d: number) {
    return Math.min(1, Math.max(0, (d - EASY_UNTIL * 0.5) / 900))
  }

  centerX(d: number) {
    const [a = 0, b = 0, c = 0] = this.phases
    const wiggle =
      Math.sin(d * 0.0062 + a) * 16 +
      Math.sin(d * 0.0131 + b) * 7 +
      Math.sin(d * 0.0297 + c) * 2.5
    return wiggle * (0.15 + 0.85 * this.ramp(d))
  }

  width(d: number) {
    const [, , , e = 0] = this.phases
    const base = 26 - 12 * this.ramp(d)
    // Now and then a narrow pass.
    const pinch = Math.max(0, Math.sin(d * 0.0045 + e)) ** 10 * 6
    return Math.max(9, base - pinch * this.ramp(d))
  }

  // The obstacle of segment n, if any (one segment every OBSTACLE_SPACING).
  obstacle(n: number): Obstacle | null {
    const cached = this.obstacleCache.get(n)
    if (cached !== undefined) return cached
    let result: Obstacle | null = null
    const d = n * OBSTACLE_SPACING + hash(this.seed, n * 7 + 1) * OBSTACLE_JITTER
    if (d >= OBSTACLES_FROM) {
      const odds = 0.45 + 0.45 * this.ramp(d)
      if (hash(this.seed, n * 7 + 2) < odds) {
        result = this.makeObstacle(n, d)
      }
    }
    this.obstacleCache.set(n, result)
    return result
  }

  private makeObstacle(n: number, d: number): Obstacle {
    const roll = (k: number) => hash(this.seed, n * 7 + k)
    const half = this.width(d) / 2
    const center = this.centerX(d)
    const kinds = KINDS.filter((entry) => d >= entry.from)
    const total = kinds.reduce((sum, entry) => sum + entry.weight, 0)
    let pick = roll(3) * total
    let kind: ObstacleKind = "pillar"
    for (const entry of kinds) {
      kind = entry.kind
      pick -= entry.weight
      if (pick < 0) break
    }
    switch (kind) {
      case "pillar": {
        // Thinner in a narrow pass, so there is always room around it.
        const radius = Math.min(1.6 + roll(4) * 1.4, half - 3)
        const room = Math.max(0, half - radius - 3.5)
        return { kind, d, x: center + (roll(5) * 2 - 1) * room, radius }
      }
      case "arch":
        return { kind, d, bottom: 7 + roll(6) * 9, depth: 5 }
      case "ridge":
        return { kind, d, top: 6 + roll(4) * 8, depth: 4 }
      case "blade": {
        // Covers more than half the canyon, but always leaves 6 m.
        const covered = Math.min(2 * half - 6, half * (1.05 + roll(4) * 0.3))
        const side = roll(5) < 0.5 ? -1 : 1
        return { kind, d, side, edge: center + side * (half - covered), depth: 4 }
      }
      case "gate": {
        const hole = 4.6
        const room = Math.max(0, half - hole - 1)
        const x = center + (roll(4) * 2 - 1) * room
        return { kind, d, x, y: 7 + roll(5) * 12, hole, depth: 3 }
      }
    }
  }

  obstaclesBetween(from: number, to: number): Array<Obstacle> {
    const list: Array<Obstacle> = []
    const first = Math.max(0, Math.floor(from / OBSTACLE_SPACING) - 1)
    const last = Math.ceil(to / OBSTACLE_SPACING) + 1
    for (let n = first; n <= last; n++) {
      const obstacle = this.obstacle(n)
      if (obstacle && obstacle.d >= from && obstacle.d <= to) list.push(obstacle)
    }
    return list
  }

  // How far the rocket at (x, y), distance d, is from hitting anything
  // (negative: it hit). Only obstacles count: the rocket slides along the
  // side walls and the floor (see clampX and clampY).
  clearance(d: number, x: number, y: number): number {
    let clear = Infinity
    for (const obstacle of this.obstaclesBetween(d - 6, d + 6)) {
      if (obstacle.kind === "pillar") {
        const dz = obstacle.d - d
        const gap = Math.hypot(x - obstacle.x, dz) - obstacle.radius
        clear = Math.min(clear, gap)
        continue
      }
      if (Math.abs(obstacle.d - d) >= obstacle.depth / 2 + ROCKET_RADIUS) continue
      if (obstacle.kind === "arch") clear = Math.min(clear, obstacle.bottom - y)
      else if (obstacle.kind === "ridge") clear = Math.min(clear, y - obstacle.top)
      else if (obstacle.kind === "blade") clear = Math.min(clear, obstacle.side * (obstacle.edge - x))
      else clear = Math.min(clear, obstacle.hole - Math.hypot(x - obstacle.x, y - obstacle.y))
    }
    return clear - ROCKET_RADIUS
  }

  // Keeps the rocket off the floor and under the ceiling.
  clampY(y: number) {
    return Math.max(FLOOR + ROCKET_RADIUS, Math.min(CEILING, y))
  }

  // Keeps the rocket between the side walls.
  clampX(d: number, x: number) {
    const room = this.width(d) / 2 - ROCKET_RADIUS
    const center = this.centerX(d)
    return Math.max(center - room, Math.min(center + room, x))
  }
}

// The rocket's speed (m/s) after `t` seconds of flight: fast from the
// start, steady for five seconds, then faster and faster, up to MAX_SPEED.
export function speedAt(t: number) {
  if (t < 5) return 55
  return Math.min(MAX_SPEED, 55 + (t - 5) * 1.3)
}
