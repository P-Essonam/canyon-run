import { DurableObject } from "cloudflare:workers"
import { MAX_PLAYERS } from "../shared/protocol"
import { cleanName, plausible, saveScore } from "./scores"
import type {
  GameState,
  PhoneMessage,
  ScreenMessage,
  ToPhoneMessage,
  ToScreenMessage,
} from "../shared/protocol"

// One game room: one screen and up to two phones. The screen runs the
// game; the room relays tilt to it, relays the game's state to the phones,
// hands out player slots and saves scores. It sleeps between messages
// (WebSocket hibernation), so what it must remember lives in storage.

type Attachment =
  | { role: "screen" }
  | { role: "phone"; pid: string; slot: number }

type Result = {
  run: number
  distance: number
  durationMs: number
  submitted: boolean
}

type Stored = {
  phase: GameState["phase"]
  startedAt: number
  // Counts games, so each run is recorded once.
  run: number
  // slot → pid of the phone that holds it.
  slots: Record<number, string>
  // pid → that phone's last finished run.
  results: Record<string, Result>
  last: GameState | null
}

const PID_PATTERN = /^[a-z0-9]{8,24}$/

function initial(): Stored {
  return {
    phase: "lobby",
    startedAt: 0,
    run: 0,
    slots: {},
    results: {},
    last: null,
  }
}

export class Room extends DurableObject<Env> {
  private load(): Stored {
    return this.ctx.storage.kv.get<Stored>("room") ?? initial()
  }

  private save(room: Stored) {
    this.ctx.storage.kv.put("room", room)
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const role = url.searchParams.get("role")
    const pair = new WebSocketPair()
    const [client, server] = [pair[0], pair[1]]

    if (role === "screen") {
      for (const ws of this.sockets("screen")) ws.close(4000, "Replaced")
      this.ctx.acceptWebSocket(server, ["screen"])
      server.serializeAttachment({ role: "screen" } satisfies Attachment)
      this.send(server, this.playersMessage(this.load()))
      return new Response(null, { status: 101, webSocket: client })
    }

    const pid = url.searchParams.get("pid") ?? ""
    if (role !== "phone" || !PID_PATTERN.test(pid)) {
      return new Response("Bad request", { status: 400 })
    }

    const room = this.load()
    let slot = this.slotOf(room, pid)
    if (slot === null && (room.phase === "lobby" || room.phase === "over")) {
      slot = this.freeSlot(room)
      if (slot !== null) room.slots[slot] = pid
    }

    if (slot === null) {
      server.accept()
      this.send(server, { t: "full" } satisfies ToPhoneMessage)
      server.close(4001, "Full")
      return new Response(null, { status: 101, webSocket: client })
    }

    // The same phone reconnecting replaces its old socket.
    for (const ws of this.sockets("phone")) {
      const attachment = ws.deserializeAttachment() as Attachment | null
      if (attachment?.role === "phone" && attachment.pid === pid) {
        ws.close(4000, "Replaced")
      }
    }
    this.ctx.acceptWebSocket(server, ["phone"])
    server.serializeAttachment({ role: "phone", pid, slot } satisfies Attachment)
    this.save(room)
    this.send(server, { t: "welcome", slot } satisfies ToPhoneMessage)
    if (room.last) this.send(server, { t: "state", state: room.last })
    this.toScreen(this.playersMessage(room))
    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== "string" || raw.length > 2000) return
    let message: unknown
    try {
      message = JSON.parse(raw)
    } catch {
      return
    }
    const attachment = ws.deserializeAttachment() as Attachment | null
    if (!attachment) return
    if (attachment.role === "screen") {
      this.fromScreen(message as ScreenMessage)
    } else {
      await this.fromPhone(ws, attachment, message as PhoneMessage)
    }
  }

  async webSocketClose(ws: WebSocket) {
    const attachment = ws.deserializeAttachment() as Attachment | null
    if (attachment?.role !== "phone") return
    const room = this.load()
    // Between games a phone that leaves gives its slot back. During one it
    // keeps it, so it can reconnect; the screen decides when it has quit.
    const stillHere = this.sockets("phone").some((other) => {
      if (other === ws) return false
      const a = other.deserializeAttachment() as Attachment | null
      return a?.role === "phone" && a.pid === attachment.pid
    })
    if (!stillHere && (room.phase === "lobby" || room.phase === "over")) {
      if (room.slots[attachment.slot] === attachment.pid) {
        delete room.slots[attachment.slot]
        this.save(room)
      }
    }
    this.toScreen(this.playersMessage(room, ws))
  }

  async webSocketError(ws: WebSocket) {
    await this.webSocketClose(ws)
  }

  private fromScreen(message: ScreenMessage) {
    if (message.t === "graze") {
      for (const ws of this.phonesIn(message.slot)) {
        this.send(ws, { t: "graze" } satisfies ToPhoneMessage)
      }
      return
    }
    if (message.t !== "state") return
    const state = message.state
    const room = this.load()
    const now = Date.now()

    if (state.phase === "flying" && room.phase !== "flying") {
      room.startedAt = now
      room.run += 1
    }
    // A player whose run just ended: remember it, for the leaderboard.
    if (state.phase === "flying" || state.phase === "over") {
      for (const player of state.players) {
        const pid = room.slots[player.slot]
        if (!pid || player.alive || room.results[pid]?.run === room.run) {
          continue
        }
        room.results[pid] = {
          run: room.run,
          distance: Math.round(player.distance),
          durationMs: now - room.startedAt,
          submitted: false,
        }
      }
    }
    if (state.phase === "lobby" && room.phase !== "lobby") {
      // Free the slots of phones that left during the game.
      const connected = new Set(
        this.sockets("phone").map(
          (ws) => (ws.deserializeAttachment() as Attachment & { pid: string }).pid
        )
      )
      for (const [slot, pid] of Object.entries(room.slots)) {
        if (!connected.has(pid)) delete room.slots[Number(slot)]
      }
    }
    room.phase = state.phase
    room.last = state
    this.save(room)
    for (const ws of this.sockets("phone")) {
      this.send(ws, { t: "state", state } satisfies ToPhoneMessage)
    }
  }

  private async fromPhone(
    ws: WebSocket,
    attachment: Extract<Attachment, { role: "phone" }>,
    message: PhoneMessage
  ) {
    const slot = attachment.slot
    switch (message.t) {
      case "ready":
        this.toScreen({ t: "ready", slot })
        return
      case "tilt":
        this.toScreen({
          t: "tilt",
          slot,
          r: clamp(Number(message.r) || 0),
          p: clamp(Number(message.p) || 0),
        })
        return
      case "quit":
        this.toScreen({ t: "quit", slot })
        return
      case "submit":
        await this.submit(ws, attachment.pid, String(message.name ?? ""))
        return
    }
  }

  private async submit(ws: WebSocket, pid: string, rawName: string) {
    const room = this.load()
    const result = room.results[pid]
    const reply = (ok: boolean, reason?: string) =>
      this.send(ws, { t: "submitted", ok, reason } satisfies ToPhoneMessage)
    if (!result || result.submitted) return reply(false, "No run to save")
    const name = cleanName(rawName)
    if (!name) return reply(false, "Pick another name")
    if (!plausible(result.distance, result.durationMs)) {
      return reply(false, "That run can't be saved")
    }
    try {
      await saveScore(this.env.DB, name, result.distance)
    } catch (error) {
      console.error("Saving a score failed", error)
      return reply(false, "Couldn't save, try again")
    }
    result.submitted = true
    this.save(room)
    reply(true)
  }

  private sockets(tag: "screen" | "phone") {
    return this.ctx.getWebSockets(tag)
  }

  private phonesIn(slot: number) {
    return this.sockets("phone").filter((ws) => {
      const a = ws.deserializeAttachment() as Attachment | null
      return a?.role === "phone" && a.slot === slot
    })
  }

  private slotOf(room: Stored, pid: string): number | null {
    for (const [slot, owner] of Object.entries(room.slots)) {
      if (owner === pid) return Number(slot)
    }
    return null
  }

  private freeSlot(room: Stored): number | null {
    const seats = Math.min(MAX_PLAYERS, room.last?.seats ?? 1)
    for (let slot = 0; slot < seats; slot++) {
      if (!(slot in room.slots)) return slot
    }
    return null
  }

  private playersMessage(room: Stored, closing?: WebSocket): ToScreenMessage {
    const open = this.sockets("phone").filter((ws) => ws !== closing)
    return {
      t: "players",
      players: Object.entries(room.slots).map(([slot, pid]) => ({
        slot: Number(slot),
        connected: open.some((ws) => {
          const a = ws.deserializeAttachment() as Attachment | null
          return a?.role === "phone" && a.pid === pid
        }),
      })),
    }
  }

  private toScreen(message: ToScreenMessage) {
    for (const ws of this.sockets("screen")) this.send(ws, message)
  }

  private send(ws: WebSocket, message: unknown) {
    try {
      ws.send(JSON.stringify(message))
    } catch {
      // The socket is closing; the next state reaches it after reconnect.
    }
  }
}

function clamp(value: number) {
  return Math.max(-1, Math.min(1, value))
}
