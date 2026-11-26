// The messages between the screen, the phones and the room (a Durable
// Object). The screen runs the game; the room relays and keeps the slots.

export const MAX_PLAYERS = 2
export const ROOM_PATTERN = /^[a-z0-9]{4,12}$/
export const NAME_MAX = 12

// Tilt is sent about 30 times a second while flying.
export const TILT_INTERVAL_MS = 16
// A phone gone longer than this during a game counts as quit.
export const DISCONNECT_GRACE_MS = 5000
// No sensor reading this soon after "Ready": the phone steers by drag.
export const SENSOR_TIMEOUT_MS = 700

// The rocket never goes faster than this (m/s). The game flies up to it
// (see speedAt) and the room uses it to reject a distance no real game
// could reach, so both always agree.
export const MAX_SPEED = 85

export type Phase = "lobby" | "countdown" | "flying" | "over"

export type PlayerState = {
  slot: number
  connected: boolean
  ready: boolean
  alive: boolean
  distance: number
}

export type GameState = {
  phase: Phase
  // How many phones may join: 1 by default, 2 when the screen picks it.
  seats: number
  // Seconds left in the countdown.
  countdown: number
  distance: number
  players: Array<PlayerState>
  // The winning slot of a two-player game, once it is over.
  winner: number | null
}

// Phone → room.
export type PhoneMessage =
  | { t: "ready" }
  | { t: "tilt"; r: number; p: number }
  | { t: "quit" }
  | { t: "submit"; name: string }

// Room → phone.
export type ToPhoneMessage =
  | { t: "welcome"; slot: number }
  | { t: "full" }
  | { t: "state"; state: GameState }
  | { t: "graze" }
  | { t: "submitted"; ok: boolean; reason?: SubmitError }

// Screen → room.
export type ScreenMessage =
  | { t: "state"; state: GameState }
  | { t: "graze"; slot: number }

// Room → screen.
export type ToScreenMessage =
  | { t: "players"; players: Array<{ slot: number; connected: boolean }> }
  | { t: "ready"; slot: number }
  | { t: "tilt"; slot: number; r: number; p: number }
  | { t: "quit"; slot: number }

export type LeaderboardEntry = { name: string; distance: number }
export type Leaderboard = {
  allTime: Array<LeaderboardEntry>
  today: Array<LeaderboardEntry>
}

export const PLAYER_COLORS = ["#8b3dff", "#22d3ee"] as const

export const CONIC_URL = "https://useconic.dev/?ref=canyon-run"

// Why a score was not saved. The phone shows it in its own language.
export type SubmitError = "noRun" | "badName" | "implausible" | "saveFailed"
