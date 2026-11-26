import { MAX_SPEED, NAME_MAX } from "../shared/protocol"
import type { Leaderboard, LeaderboardEntry } from "../shared/protocol"

// The leaderboard, in D1. The table creates itself on first use, so a
// fresh deployment needs no migration step.

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    distance INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS scores_distance ON scores (distance DESC)`,
  `CREATE INDEX IF NOT EXISTS scores_created ON scores (created_at)`,
]

let ready: Promise<unknown> | null = null

function ensureSchema(db: D1Database) {
  ready ??= db.batch(SCHEMA.map((sql) => db.prepare(sql))).catch((error) => {
    ready = null
    throw error
  })
  return ready
}

const TOP = 10

export async function readLeaderboard(db: D1Database): Promise<Leaderboard> {
  await ensureSchema(db)
  const dayStart = new Date()
  dayStart.setUTCHours(0, 0, 0, 0)
  const [allTime, today] = await db.batch<LeaderboardEntry>([
    db.prepare(
      `SELECT name, distance FROM scores ORDER BY distance DESC LIMIT ?`
    ).bind(TOP),
    db.prepare(
      `SELECT name, distance FROM scores WHERE created_at >= ?
       ORDER BY distance DESC LIMIT ?`
    ).bind(dayStart.getTime(), TOP),
  ])
  return { allTime: allTime?.results ?? [], today: today?.results ?? [] }
}

export async function saveScore(
  db: D1Database,
  name: string,
  distance: number
) {
  await ensureSchema(db)
  await db
    .prepare(`INSERT INTO scores (name, distance, created_at) VALUES (?, ?, ?)`)
    .bind(name, distance, Date.now())
    .run()
}

// A distance the rocket could have flown in that time, with some slack
// for the screen's clock.
export function plausible(distance: number, durationMs: number) {
  return distance >= 0 && distance <= (MAX_SPEED * durationMs) / 1000 + 50
}

// Words a name may not contain, after folding look-alike characters.
const BLOCKED = [
  "fuck", "shit", "cunt", "bitch", "nigg", "fag", "rape", "nazi", "hitler",
  "dick", "cock", "pussy", "whore", "slut", "porn", "penis",
  "pute", "salope", "connard", "connasse", "encule", "nique", "batard",
  "couille", "chatte", "merde", "negre",
]

const FOLD: Record<string, string> = {
  "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a",
  "$": "s", "!": "i",
}

// The name to store, or null when it is empty or blocked.
export function cleanName(raw: string): string | null {
  const name = raw
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N} _.\-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, NAME_MAX)
  if (!name) return null
  const folded = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/./g, (char) => FOLD[char] ?? char)
    .replace(/[^a-z]/g, "")
  if (BLOCKED.some((word) => folded.includes(word))) return null
  return name
}
