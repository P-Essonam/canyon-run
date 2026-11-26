import { createFileRoute } from "@tanstack/react-router"
import { useCallback, useEffect, useRef, useState } from "react"
import { RoomSocket, randomId, roomUrl } from "../lib/socket"
import { PoweredByConic } from "../lib/conic"
import {
  NAME_MAX,
  PLAYER_COLORS,
  ROOM_PATTERN,
  SENSOR_TIMEOUT_MS,
  TILT_INTERVAL_MS,
} from "../shared/protocol"
import type { GameState, PhoneMessage, ToPhoneMessage } from "../shared/protocol"
import type { SocketStatus } from "../lib/socket"

// The phone: a controller for one rocket. Tilt to steer; without motion
// sensors (or without permission), drag on the ring instead.

export const Route = createFileRoute("/c/$room")({
  component: ControllerPage,
  ssr: false,
  // A room's controller is private to the people playing: keep it out of
  // search results.
  head: () => ({
    meta: [
      { title: "Canyon Run – Controller" },
      { name: "robots", content: "noindex" },
    ],
  }),
})

const PID_KEY = "canyon-run:pid"
const NAME_KEY = "canyon-run:name"

function stored(key: string, fallback: () => string) {
  try {
    const value = localStorage.getItem(key)
    if (value) return value
    const fresh = fallback()
    if (fresh) localStorage.setItem(key, fresh)
    return fresh
  } catch {
    return fallback()
  }
}

function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Private mode: fine, it just won't be remembered.
  }
}

// Degrees of tilt for full steering.
const ROLL_RANGE = 24
const PITCH_RANGE = 16
// The drag distance (px) for full steering.
const DRAG_RANGE = 90

// How the player steers: motion sensors, or a thumb on the screen.
type Control = "tilt" | "touch"
const CONTROL_KEY = "canyon-run:control"

type Run = { distance: number }
type Submit = "idle" | "sending" | "saved" | "skipped" | { error: string }

function clamp(value: number) {
  return Math.max(-1, Math.min(1, value))
}

// A small dead zone, then a curve that answers small tilts quickly:
// sqrt-ish, so a third of the range already gives over half the push.
function shape(value: number) {
  const size = Math.abs(value)
  if (size < 0.04) return 0
  return Math.sign(value) * Math.min(1, ((size - 0.04) / 0.96) ** 0.7)
}

function ControllerPage() {
  const { room } = Route.useParams()
  if (!ROOM_PATTERN.test(room)) {
    return (
      <main className="pad">
        <div className="pad-body">
          <p className="notice-title">Wrong link</p>
          <p className="pad-hint">Scan the code on the screen again.</p>
        </div>
      </main>
    )
  }
  return <Controller room={room} />
}

function Controller({ room }: { room: string }) {
  const [pid] = useState(() => stored(PID_KEY, () => randomId(12)))
  const [status, setStatus] = useState<SocketStatus>("connecting")
  const [full, setFull] = useState(false)
  const [slot, setSlot] = useState<number | null>(null)
  const [state, setState] = useState<GameState | null>(null)
  const [readySent, setReadySent] = useState(false)
  const [dragMode, setDragMode] = useState(false)
  const [control, setControl] = useState<Control>(() =>
    stored(CONTROL_KEY, () => "") === "touch" ? "touch" : "tilt"
  )
  // Set once tilt failed: no permission, or no sensor readings.
  const [noSensor, setNoSensor] = useState(false)
  const [run, setRun] = useState<Run | null>(null)
  const [submit, setSubmit] = useState<Submit>("idle")
  const [name, setName] = useState(() => stored(NAME_KEY, () => ""))

  const socket = useRef<RoomSocket<ToPhoneMessage, PhoneMessage> | null>(null)
  const sensor = useRef<{ beta: number; gamma: number } | null>(null)
  const neutral = useRef<{ beta: number; gamma: number } | null>(null)
  const drag = useRef<{ x: number; y: number; r: number; p: number } | null>(null)
  const dot = useRef<HTMLDivElement>(null)
  const wasAlive = useRef(false)
  const slotRef = useRef<number | null>(null)

  useEffect(() => {
    const ws = new RoomSocket<ToPhoneMessage, PhoneMessage>(
      roomUrl(room, `role=phone&pid=${pid}`),
      (message) => {
        switch (message.t) {
          case "welcome":
            slotRef.current = message.slot
            setSlot(message.slot)
            return
          case "full":
            setFull(true)
            return
          case "state":
            setState(message.state)
            return
          case "graze":
            navigator.vibrate?.(15)
            return
          case "submitted":
            setSubmit(message.ok ? "saved" : { error: message.reason ?? "Couldn't save" })
            return
        }
      },
      setStatus,
      [4000, 4001]
    )
    socket.current = ws
    return () => ws.close()
  }, [room, pid])

  // Motion sensors: keep the latest reading.
  useEffect(() => {
    const onOrientation = (event: DeviceOrientationEvent) => {
      if (event.beta === null || event.gamma === null) return
      sensor.current = { beta: event.beta, gamma: event.gamma }
      neutral.current ??= sensor.current
    }
    window.addEventListener("deviceorientation", onOrientation)
    return () => window.removeEventListener("deviceorientation", onOrientation)
  }, [])

  const me = state?.players.find((p) => p.slot === slot) ?? null
  const phase = state?.phase ?? "lobby"
  const flying = (phase === "flying" || phase === "countdown") && !!me?.alive

  // "Straight ahead" is how the phone is held when the countdown ends, not
  // when Launch was tapped: people settle their grip during the countdown.
  useEffect(() => {
    if (phase === "flying" && sensor.current) neutral.current = sensor.current
  }, [phase])

  // My run ending: buzz and show the result.
  useEffect(() => {
    if (!me) return
    if (wasAlive.current && !me.alive && (phase === "flying" || phase === "over")) {
      navigator.vibrate?.([70, 40, 180])
      setRun({ distance: me.distance })
      setReadySent(false)
      setSubmit("idle")
    }
    if (me.alive && phase !== "lobby") setReadySent(false)
    wasAlive.current = me.alive && phase !== "lobby"
  }, [me?.alive, me?.distance, phase])

  // Send tilt while my rocket is up.
  useEffect(() => {
    if (!flying) return
    const timer = setInterval(() => {
      let r = 0
      let p = 0
      if (dragMode) {
        r = drag.current?.r ?? 0
        p = drag.current?.p ?? 0
      } else if (sensor.current && neutral.current) {
        r = clamp((sensor.current.gamma - neutral.current.gamma) / ROLL_RANGE)
        p = clamp((sensor.current.beta - neutral.current.beta) / PITCH_RANGE)
      }
      r = shape(r)
      p = shape(p)
      socket.current?.send({ t: "tilt", r, p })
      if (dot.current) {
        dot.current.style.transform = `translate(${r * 70}px, ${-p * 70}px)`
      }
    }, TILT_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [flying, dragMode])

  const pickControl = (next: Control) => {
    setControl(next)
    remember(CONTROL_KEY, next)
  }

  const launch = useCallback(async () => {
    const touch = control === "touch" || noSensor
    let allowed = !touch
    if (!touch) {
      const api =
        typeof DeviceOrientationEvent === "undefined"
          ? null
          : (DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> })
      if (!api) allowed = false
      // iOS asks for permission, and only from a tap.
      else if (typeof api.requestPermission === "function") {
        allowed = await api
          .requestPermission()
          .then((answer) => answer === "granted")
          .catch(() => false)
      }
      if (!allowed) setNoSensor(true)
    }
    // Where the phone is now is "straight ahead".
    neutral.current = sensor.current
    setDragMode(!allowed)
    if (allowed) {
      setTimeout(() => {
        if (sensor.current) return
        setDragMode(true)
        setNoSensor(true)
      }, SENSOR_TIMEOUT_MS)
    }
    setRun(null)
    setReadySent(true)
    socket.current?.send({ t: "ready" })
  }, [control, noSensor])

  const picker = (
    <div className="pad-switch" role="radiogroup" aria-label="Steering">
      {(["tilt", "touch"] as const).map((key) => {
        const on = key === "tilt" ? control === "tilt" && !noSensor : control === "touch" || noSensor
        return (
          <button
            key={key}
            role="radio"
            aria-checked={on}
            className={on ? "is-on" : ""}
            disabled={key === "tilt" && noSensor}
            onClick={() => pickControl(key)}
          >
            {key === "tilt" ? "Tilt" : "Touch"}
          </button>
        )
      })}
    </div>
  )
  const pickerHint = noSensor
    ? "Motion sensors are off on this phone: steer with your thumb."
    : control === "tilt"
      ? "Hold your phone the way that feels straight ahead, then tap."
      : "Hold anywhere on the screen and slide your thumb to steer."

  const save = () => {
    const trimmed = name.trim().slice(0, NAME_MAX)
    if (!trimmed) return
    remember(NAME_KEY, trimmed)
    setSubmit("sending")
    socket.current?.send({ t: "submit", name: trimmed })
  }

  const color = slot === null ? "#ffffff" : PLAYER_COLORS[slot]
  const style = { "--player": color } as React.CSSProperties

  if (full) {
    return (
      <Shell style={style}>
        <Notice title="Game is full" text="Someone is already playing on this screen. Wait for the next game, or pick 2 players on the screen." />
      </Shell>
    )
  }

  if (slot === null || status === "closed") {
    return (
      <Shell style={style}>
        {status === "closed" ? (
          <Notice title="Disconnected" text="Scan the code on the screen again." />
        ) : (
          <div className="pad-body">
            <span className="spinner" aria-hidden="true" />
            <p className="pad-label">Connecting</p>
          </div>
        )}
      </Shell>
    )
  }

  // Flying (or about to): the steering pad.
  if (flying) {
    const onDown = (event: React.PointerEvent) => {
      if (!dragMode) return
      event.currentTarget.setPointerCapture(event.pointerId)
      drag.current = { x: event.clientX, y: event.clientY, r: 0, p: 0 }
    }
    const onMove = (event: React.PointerEvent) => {
      const start = drag.current
      if (!start) return
      start.r = clamp((event.clientX - start.x) / DRAG_RANGE)
      start.p = clamp((start.y - event.clientY) / DRAG_RANGE)
    }
    const onUp = () => {
      drag.current = null
    }
    return (
      <Shell
        style={style}
        player={slot}
        className="is-flying"
        action={
          <button
            className="pad-quit"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => socket.current?.send({ t: "quit" })}
          >
            Quit
          </button>
        }
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <div className="pad-body">
          <div className="ring">
            <span className="ring-axis ring-axis-x" />
            <span className="ring-axis ring-axis-y" />
            <span className="ring-inner" />
            {phase === "countdown" ? (
              <span className="ring-count" key={state?.countdown}>
                {state?.countdown}
              </span>
            ) : (
              <div className="ring-dot" ref={dot} />
            )}
          </div>
        </div>
        <footer className="pad-foot">
          <p className="pad-label">
            {phase === "countdown" ? "Get ready" : dragMode ? "Drag to steer" : "Tilt to steer"}
          </p>
          <p className="pad-hint">
            {dragMode
              ? "Hold anywhere and slide your thumb"
              : "Left and right to turn, forward and back to dive and climb"}
          </p>
        </footer>
      </Shell>
    )
  }

  // My run is over: result, name for the leaderboard, again.
  if (run) {
    const twoPlayers = (state?.players.filter((p) => p.distance > 0 || p.alive).length ?? 0) > 1
    return (
      <Shell style={style} player={slot} className="is-over">
        <div className="pad-body">
          <div className="result">
            <p className="pad-label">
              {phase === "over" && twoPlayers ? verdict(state, slot) : "Distance"}
            </p>
            <p className="result-distance">
              {run.distance}
              <span>m</span>
            </p>
            {twoPlayers && phase === "flying" && (
              <p className="pad-hint">The other rocket is still flying…</p>
            )}
          </div>

          {submit === "saved" ? (
            <p className="saved">Saved to the leaderboard</p>
          ) : submit === "skipped" ? null : (
            <form
              className="name-form"
              onSubmit={(event) => {
                event.preventDefault()
                save()
              }}
            >
              <label className="pad-label" htmlFor="name">
                Leaderboard name
              </label>
              <div className="name-row">
                <input
                  id="name"
                  value={name}
                  maxLength={NAME_MAX}
                  placeholder="Your name"
                  autoComplete="nickname"
                  onChange={(event) => setName(event.target.value)}
                />
                <button type="submit" disabled={submit === "sending" || !name.trim()}>
                  {submit === "sending" ? "Saving…" : "Save"}
                </button>
              </div>
              {typeof submit === "object" && <p className="error">{submit.error}</p>}
              <button type="button" className="link" onClick={() => setSubmit("skipped")}>
                Skip
              </button>
            </form>
          )}
        </div>
        <footer className="pad-foot">
          {picker}
          <button className="primary" onClick={() => void launch()}>
            Launch again
          </button>
          <PoweredByConic className="badge-phone" label="Deploy your own with" />
        </footer>
      </Shell>
    )
  }

  if (readySent) {
    const waitingFor = state?.players.find((p) => p.slot !== slot && p.connected && !p.ready)
    return (
      <Shell style={style} player={slot}>
        <div className="pad-body">
          <span className="spinner" aria-hidden="true" />
          <p className="pad-label">
            {phase === "flying" || phase === "over"
              ? "Next game starts soon"
              : waitingFor
                ? `Waiting for player ${waitingFor.slot + 1}`
                : "Ready"}
          </p>
        </div>
      </Shell>
    )
  }

  return (
    <Shell style={style} player={slot} className="is-idle">
      <div className="pad-body">
        <div className="ring is-idle">
          <span className="ring-axis ring-axis-x" />
          <span className="ring-axis ring-axis-y" />
          <span className="ring-inner" />
          <div className="ring-dot" />
        </div>
      </div>
      <footer className="pad-foot">
        <p className="pad-label">Steer by</p>
        {picker}
        <p className="pad-hint">{pickerHint}</p>
        <button className="primary" onClick={() => void launch()}>
          Launch
        </button>
      </footer>
    </Shell>
  )
}

function verdict(state: GameState | null, slot: number) {
  if (!state || state.winner === null) return "It's a tie"
  return state.winner === slot ? "You win" : `Player ${state.winner + 1} wins`
}

// The frame every phone screen shares: name on the left, player (or Quit)
// on the right, then the content.
function Shell({
  player,
  className = "",
  action,
  children,
  ...rest
}: {
  player?: number
  className?: string
  action?: React.ReactNode
  children: React.ReactNode
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <main className={`pad ${className}`} {...rest}>
      <header className="pad-top">
        <span className="pad-brand">Canyon Run</span>
        {action ??
          (player !== undefined && (
            <span className="pad-chip">
              <span className="dot" />
              Player {player + 1}
            </span>
          ))}
      </header>
      {children}
    </main>
  )
}

function Notice({ title, text }: { title: string; text: string }) {
  return (
    <div className="pad-body">
      <p className="notice-title">{title}</p>
      <p className="pad-hint">{text}</p>
    </div>
  )
}
