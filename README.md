# Canyon Run

Fly a rocket through a red-rock desert canyon. Steer by tilting your phone.

Open the game on a computer and scan the QR code with your phone. The phone becomes the controller. You can play alone or with two phones on one screen. The canyon gets faster and narrower the further you go, and the best distances go on a leaderboard.

## Deploy your own

Canyon Run runs entirely on Cloudflare:

- A Worker serves the app (TanStack Start).
- A Durable Object for each room relays messages between the screen and the phones over WebSockets.
- A D1 database stores the leaderboard. The table is created on the first request, so there are no migrations to run.

The quickest way to deploy it is the [Canyon Run template on Conic](https://useconic.dev/templates/canyon-run?ref=canyon-run): choose **Deploy now** and Conic creates the Worker, the Durable Object and the D1 database on your Cloudflare account, with nothing to fork. When this repository gets a new version, your project shows **New version available**, and nothing changes until you choose **Update**.

To deploy it yourself with Wrangler:

```sh
pnpm install
pnpm wrangler d1 create canyon-run   # add the printed database_id to wrangler.jsonc
pnpm deploy
```

On your own domain, set `SITE_URL` in `src/shared/site.ts`: the canonical link and the share card point to it.

## Run it locally

```sh
pnpm install
pnpm dev
```

Open http://localhost:3100 on your computer. To control the rocket from a phone, the phone must reach your computer. Use a tunnel, or open `/c/<room>` in a second browser window and drag on the ring to steer.

## How it plays

- Tap **Tap to launch** on the phone. The way you hold the phone at that moment is "straight ahead".
- Tilt left and right to turn, forward and back to go down and up.
- If the phone has no motion sensor, or you deny access to it, drag on the ring instead.
- With two players, the game starts when both phones are ready. The game ends when both rockets have crashed or quit.

## License

MIT
