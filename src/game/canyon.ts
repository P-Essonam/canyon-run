// The canyon as numbers: where its middle is, how wide it is and what
// stands in it, at any distance `d` (meters) from the start. The rocket
// flies toward -z, so world z = -d. Seeded, so each game gets its own
// canyon while rendering and collisions agree.

export const WALL_HEIGHT = 46
export const CEILING = 28
export const FLOOR = 0.6
export const ROCKET_RADIUS = 0.9

// The first stretch is straight and wide, so a first try always lasts.
const EASY_UNTIL = 260
const OBSTACLES_FROM = 320
const OBSTACLE_SPACING = 70

export type Obstacle =
  | { kind: "pillar"; d: number; x: number; radius: number }
  // An arch across the canyon: fly under its bottom.
  | { kind: "arch"; d: number; bottom: number; depth: number }

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
    const d = n * OBSTACLE_SPACING + hash(this.seed, n * 7 + 1) * 30
    if (d >= OBSTACLES_FROM) {
      const odds = 0.45 + 0.45 * this.ramp(d)
      if (hash(this.seed, n * 7 + 2) < odds) {
        const half = this.width(d) / 2
        if (hash(this.seed, n * 7 + 3) < 0.6) {
          const radius = 1.6 + hash(this.seed, n * 7 + 4) * 1.4
          const room = Math.max(0, half - radius - 3.5)
          const side = hash(this.seed, n * 7 + 5) * 2 - 1
          result = { kind: "pillar", d, x: this.centerX(d) + side * room, radius }
        } else {
          const bottom = 7 + hash(this.seed, n * 7 + 6) * 9
          result = { kind: "arch", d, bottom, depth: 5 }
        }
      }
    }
    this.obstacleCache.set(n, result)
    return result
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
  // (negative: it hit). Also says whether it is close to a wall.
  clearance(d: number, x: number, y: number): number {
    const half = this.width(d) / 2
    let clear = Math.min(half - Math.abs(x - this.centerX(d)), y - FLOOR)
    for (const obstacle of this.obstaclesBetween(d - 6, d + 6)) {
      if (obstacle.kind === "pillar") {
        const dz = obstacle.d - d
        const gap = Math.hypot(x - obstacle.x, dz) - obstacle.radius
        clear = Math.min(clear, gap)
      } else if (Math.abs(obstacle.d - d) < obstacle.depth / 2 + ROCKET_RADIUS) {
        clear = Math.min(clear, obstacle.bottom - y)
      }
    }
    return clear - ROCKET_RADIUS
  }
}

// The rocket's speed (m/s) after `t` seconds of flight: gentle for the
// first ten seconds, then faster and faster, up to MAX_SPEED.
export function speedAt(t: number) {
  if (t < 8) return 32
  return Math.min(70, 32 + (t - 8) * 1.15)
}
