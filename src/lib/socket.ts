// A WebSocket to a room that reconnects by itself, with a growing delay.
// Messages sent while it is down are dropped: tilt and state go stale in
// milliseconds, and the room sends the current state on every connect.

export type SocketStatus = "connecting" | "open" | "closed"

export class RoomSocket<In, Out> {
  private ws: WebSocket | null = null
  private attempts = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private stopped = false

  constructor(
    private url: string,
    private onMessage: (message: In) => void,
    private onStatus: (status: SocketStatus) => void = () => {},
    // Close codes after which reconnecting is pointless (e.g. a full room).
    private finalCodes: Array<number> = []
  ) {
    this.connect()
  }

  send(message: Out) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message))
    }
  }

  // For a stream where only the latest value matters (tilt): sends only
  // when everything sent before has left the phone. On a slow network,
  // queued readings would arrive late, one after the other, and the rocket
  // would lag behind the hand more and more. Returns whether it sent.
  sendLatest(message: Out) {
    if (this.ws?.readyState !== WebSocket.OPEN || this.ws.bufferedAmount > 0) {
      return false
    }
    this.ws.send(JSON.stringify(message))
    return true
  }

  close() {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.ws?.close()
  }

  private connect() {
    this.onStatus("connecting")
    const ws = new WebSocket(this.url)
    this.ws = ws
    ws.onopen = () => {
      this.attempts = 0
      this.onStatus("open")
    }
    ws.onmessage = (event) => {
      try {
        this.onMessage(JSON.parse(String(event.data)) as In)
      } catch {
        // Not ours.
      }
    }
    ws.onclose = (event) => {
      if (this.ws !== ws) return
      this.ws = null
      if (this.stopped || this.finalCodes.includes(event.code)) {
        this.onStatus("closed")
        return
      }
      this.onStatus("connecting")
      const delay = Math.min(5000, 300 * 2 ** this.attempts++)
      this.timer = setTimeout(() => this.connect(), delay)
    }
  }
}

export function roomUrl(room: string, query: string) {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:"
  return `${protocol}//${location.host}/api/rooms/${room}/ws?${query}`
}

export function randomId(length: number) {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789"
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("")
}
