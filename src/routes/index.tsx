import { createFileRoute } from "@tanstack/react-router"
import { useEffect, useRef, useState } from "react"
import QRCode from "qrcode"
import { Game } from "../game/engine"
import { Sound } from "../game/audio"
import { RoomSocket, randomId, roomUrl } from "../lib/socket"
import { PoweredByConic } from "../lib/conic"
import { PLAYER_COLORS } from "../shared/protocol"
import type {
  GameState,
  Leaderboard,
  ScreenMessage,
  ToScreenMessage,
} from "../shared/protocol"

export const Route = createFileRoute("/")({
  component: ScreenPage,
  ssr: false,
})

const ROOM_KEY = "canyon-run:room"

function roomId() {
  try {
    const saved = sessionStorage.getItem(ROOM_KEY)
    if (saved) return saved
    const id = randomId(6)
    sessionStorage.setItem(ROOM_KEY, id)
    return id
  } catch {
    return randomId(6)
  }
}

function isPhone() {
  return (
    matchMedia("(pointer: coarse)").matches &&
    Math.min(screen.width, screen.height) < 600
  )
}

function ScreenPage() {
  const [phone] = useState(isPhone)
  if (phone) {
    return (
      <main className="elsewhere">
        <p>Open this page on a computer, then scan the code with this phone.</p>
        <PoweredByConic />
      </main>
    )
  }
  return <Screen />
}

function Screen() {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [room] = useState(roomId)
  const [state, setState] = useState<GameState | null>(null)
  const [muted, setMuted] = useState(true)
  const [volume, setVolume] = useState(0.7)
  const [tab, setTab] = useState<"play" | "board">("play")
  const [qr, setQr] = useState("")
  const [board, setBoard] = useState<Leaderboard>({ allTime: [], today: [] })
  const sound = useRef<Sound | null>(null)
  const game = useRef<Game | null>(null)
  const controllerUrl = `${location.origin}/c/${room}`

  useEffect(() => {
    void QRCode.toString(controllerUrl, {
      type: "svg",
      margin: 0,
      errorCorrectionLevel: "M",
      color: { dark: "#1a1030", light: "#00000000" },
    }).then(setQr)
  }, [controllerUrl])

  useEffect(() => {
    const element = canvas.current
    if (!element) return
    const audio = new Sound()
    sound.current = audio
    let socket: RoomSocket<ToScreenMessage, ScreenMessage> | null = null
    const engine = new Game(element, audio, {
      onState: (next) => socket?.send({ t: "state", state: next }),
      onGraze: (slot) => socket?.send({ t: "graze", slot }),
    })
    socket = new RoomSocket<ToScreenMessage, ScreenMessage>(
      roomUrl(room, "role=screen"),
      (message) => {
        switch (message.t) {
          case "players":
            return engine.setPlayers(message.players)
          case "ready":
            return engine.ready(message.slot)
          case "tilt":
            return engine.tilt(message.slot, message.r, message.p)
          case "quit":
            return engine.quit(message.slot)
        }
      },
      (status) => {
        if (status === "open") socket?.send({ t: "state", state: engine.snapshot() })
      },
      [4000]
    )
    game.current = engine
    const poll = setInterval(() => setState(engine.snapshot()), 100)
    return () => {
      clearInterval(poll)
      socket?.close()
      engine.dispose()
      audio.dispose()
    }
  }, [room])

  const phase = state?.phase ?? "lobby"
  useEffect(() => {
    if (phase !== "lobby") return
    fetch("/api/leaderboard")
      .then((response) => (response.ok ? (response.json() as Promise<Leaderboard>) : null))
      .then((data) => {
        if (data) setBoard(data)
      })
      .catch(() => {})
  }, [phase])

  const toggleSound = () => {
    const next = !muted
    setMuted(next)
    void sound.current?.setMuted(next)
  }

  const changeVolume = (next: number) => {
    setVolume(next)
    if (next > 0 && muted) setMuted(false)
    void sound.current?.setVolume(next)
  }

  const seats = state?.seats ?? 1

  const players = state?.players ?? []
  const playing = players.filter((p) => phase !== "lobby" && (p.alive || p.distance > 0))

  return (
    <main className="screen">
      <canvas ref={canvas} className="stage" />

      {phase === "lobby" && (
        <div className="lobby">
          <h1 className="title">Canyon Run</h1>
          <div className="card lobby-card">
            <div className="tabs" role="tablist">
              {(["play", "board"] as const).map((key) => (
                <button
                  key={key}
                  role="tab"
                  aria-selected={tab === key}
                  className={tab === key ? "is-on" : ""}
                  onClick={() => setTab(key)}
                >
                  {key === "play" ? "Play" : "Leaderboard"}
                </button>
              ))}
            </div>
            {/* Both panels share one cell, so the card keeps its size. */}
            <div className="panels">
              <Board board={board} hidden={tab !== "board"} />
            <div className={`qr-card ${tab === "play" ? "" : "is-hidden"}`} aria-hidden={tab !== "play"}>
              <div className="qr" dangerouslySetInnerHTML={{ __html: qr }} />
              <p className="scan">Scan to fly</p>
              <p className="muted">Tilt your phone to steer</p>
              <div className="seats" role="radiogroup" aria-label="Players">
                {[1, 2].map((n) => (
                  <button
                    key={n}
                    role="radio"
                    aria-checked={seats === n}
                    className={seats === n ? "is-on" : ""}
                    // Can't drop to 1 player while player 2 is in.
                    disabled={n === 1 && players.some((p) => p.slot === 1)}
                    onClick={() => game.current?.setSeats(n)}
                  >
                    {n === 1 ? "1 player" : "2 players"}
                  </button>
                ))}
              </div>
              <div className="slots">
                {Array.from({ length: seats }, (_, slot) => slot).map((slot) => {
                  const player = players.find((p) => p.slot === slot)
                  return (
                    <div
                      key={slot}
                      className={`slot ${player ? "is-in" : ""}`}
                      style={{ "--player": PLAYER_COLORS[slot] } as React.CSSProperties}
                    >
                      <span className="dot" />
                      Player {slot + 1}
                      <span className="slot-status">
                        {!player
                          ? "Waiting"
                          : !player.connected
                            ? "Reconnecting"
                            : player.ready
                              ? "Ready"
                              : "Joined"}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
            </div>
          </div>
        </div>
      )}

      {phase === "countdown" && state && (
        <div className="countdown" key={state.countdown}>
          {state.countdown}
        </div>
      )}

      {(phase === "flying" || phase === "over") && (
        <div className="hud">
          {playing.length > 1 ? (
            playing.map((p) => (
              <div
                key={p.slot}
                className={`hud-player ${p.alive ? "" : "is-out"}`}
                style={{ "--player": PLAYER_COLORS[p.slot] } as React.CSSProperties}
              >
                <span className="dot" />
                P{p.slot + 1}
                <strong>{p.alive ? state?.distance : p.distance} m</strong>
              </div>
            ))
          ) : (
            <div className="hud-distance">{state?.distance ?? 0} m</div>
          )}
        </div>
      )}

      {phase === "over" && state && (
        <div className="card over">
          <h2>Game over</h2>
          {playing.length > 1 ? (
            <p
              className="winner"
              style={{
                color: state.winner === null ? undefined : PLAYER_COLORS[state.winner],
              }}
            >
              {state.winner === null ? "It's a tie!" : `Player ${state.winner + 1} wins!`}
            </p>
          ) : null}
          <ul className="results">
            {playing.map((p) => (
              <li key={p.slot} style={{ "--player": PLAYER_COLORS[p.slot] } as React.CSSProperties}>
                <span className="dot" />
                Player {p.slot + 1}
                <strong>{p.distance} m</strong>
              </li>
            ))}
          </ul>
        </div>
      )}

      <PoweredByConic className="badge-screen" />
      <div className="sound">
        <button onClick={toggleSound} aria-label={muted ? "Turn sound on" : "Turn sound off"}>
          {muted || volume === 0 ? <SoundOff /> : <SoundOn />}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={muted ? 0 : volume}
          aria-label="Volume"
          onChange={(event) => changeVolume(Number(event.target.value))}
        />
      </div>
    </main>
  )
}

function Board({ board, hidden }: { board: Leaderboard; hidden: boolean }) {
  const [range, setRange] = useState<"today" | "allTime">("today")
  const entries = board[range]
  return (
    <div className={`board ${hidden ? "is-hidden" : ""}`} aria-hidden={hidden}>
      <div className="seats" role="radiogroup" aria-label="Range">
        {(["today", "allTime"] as const).map((key) => (
          <button
            key={key}
            role="radio"
            aria-checked={range === key}
            className={range === key ? "is-on" : ""}
            onClick={() => setRange(key)}
          >
            {key === "today" ? "Today" : "All time"}
          </button>
        ))}
      </div>
      {entries.length === 0 ? (
        <p className="muted board-empty">No runs yet. Be the first!</p>
      ) : (
        <ol>
          {entries.map((entry, index) => (
            <li key={index}>
              <span className="rank">{index + 1}</span>
              <span className="name">{entry.name}</span>
              <span className="dist">{entry.distance} m</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function SoundOn() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 5 6 9H2v6h4l5 4V5z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" />
    </svg>
  )
}

function SoundOff() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 5 6 9H2v6h4l5 4V5z" />
      <path d="m22 9-6 6M16 9l6 6" />
    </svg>
  )
}
