import handler from "@tanstack/react-start/server-entry"
import { ROOM_PATTERN } from "./shared/protocol"
import { readLeaderboard } from "./worker/scores"

// The Worker: game rooms and the leaderboard here, every other request to
// the TanStack Start app.

export { Room } from "./worker/room"

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    const room = url.pathname.match(/^\/api\/rooms\/([^/]+)\/ws$/)?.[1]
    if (room !== undefined) {
      if (!ROOM_PATTERN.test(room)) {
        return new Response("Unknown room", { status: 404 })
      }
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected a WebSocket", { status: 426 })
      }
      return env.ROOMS.get(env.ROOMS.idFromName(room)).fetch(request)
    }

    if (url.pathname === "/api/leaderboard") {
      try {
        return Response.json(await readLeaderboard(env.DB), {
          headers: { "cache-control": "no-store" },
        })
      } catch (error) {
        console.error("Reading the leaderboard failed", error)
        return Response.json({ allTime: [], today: [] }, { status: 503 })
      }
    }

    return handler.fetch(request)
  },
} satisfies ExportedHandler<Env>
