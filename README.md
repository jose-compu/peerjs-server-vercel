# peerjs-server-vercel

PeerJS signaling server for [Vercel](https://vercel.com/docs/functions/websockets) and plain Node. It speaks the same HTTP and WebSocket protocol as [peerjs-server](https://github.com/peers/peerjs-server), so [dignity.js](https://github.com/jose-compu/dignity.js) and any other PeerJS client can use a server you run yourself.

The server only forwards session descriptions and ICE candidates. It does not carry peer data channels.

## Use it from dignity.js

Deploy this repo, then point a client at:

```text
wss://YOUR-DEPLOYMENT.vercel.app/peerjs?key=peerjs
```

```js
const peer = new Peer({
  host: 'YOUR-DEPLOYMENT.vercel.app',
  port: 443,
  path: '/',
  secure: true,
  key: 'peerjs'
});
```

`path: '/'` is what the official client expects. It connects to `/peerjs` and requests ids from `/peerjs/id`.

## Deploy on Vercel

Use the free Hobby plan. The repository is already capped at the Hobby function limit, so a paid Vercel plan is not required.

### Services to turn on

| Service | Free Hobby | Paid, only if you outgrow Hobby |
| --- | --- | --- |
| Vercel account | Hobby. No credit card. | Pro, if you want a socket longer than 300 seconds or higher included usage. |
| Fluid compute | On. Required for WebSockets. New projects have it already. | Same switch. Pro does not replace it. |
| Functions | Included. This server is one Node function, `api/server.js`. | Same function. Pro can raise `maxDuration` from 300 to 800 seconds (1800 seconds is a Pro beta). |
| WebSockets | Included with Fluid compute. A socket stays open for at most 300 seconds, then the PeerJS client reconnects. | Same WebSockets. A longer `maxDuration` only lengthens the time before that reconnect. |
| Upstash Redis | Free database from the Vercel Marketplace. 256 MB and 500,000 commands per month. This is the one add-on to install. | Upstash pay-as-you-go on the same database, if the free command quota runs out. Vercel Postgres, KV, Blob, and Cron are not used. |

Leave these off. The server does not call them: Vercel Postgres, Blob, KV as a separate product, Edge Config, Cron Jobs, Queues, Secure Compute, and a paid observability add-on.

Projects created before 23 April 2025: open the project, then Settings → Functions, and turn Fluid compute on. Without that switch the WebSocket upgrade fails. Hobby and Pro both use that same switch.

### Free-tier deploy

1. Sign in at [vercel.com](https://vercel.com) with the Hobby plan.
2. Import `https://github.com/jose-compu/peerjs-server-vercel`. Framework preset can stay Other. Do not add a paid database during import.
3. Open the project → Storage or Integrations → Marketplace → [Upstash Redis](https://vercel.com/marketplace/upstash/upstash-kv) → Add Integration. Choose the free plan and region `us-east-1` (Vercel’s default region, `iad1`).
4. Connect the database to this project for Production, Preview, and Development. Vercel writes `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. Do not buy a second Redis.
5. Deploy. The signaling URL is `wss://YOUR-DEPLOYMENT.vercel.app/peerjs?key=peerjs`.
6. Confirm `https://YOUR-DEPLOYMENT.vercel.app/health` returns `"status": "ok"` and `"redis": true`.

`vercel.json` sends every public path to the one function, `api/server.js`, and leaves the browser path (`/health`, `/peerjs/id`, `/peerjs`) on the request. The destination is `/api/server` with no path suffix. A suffix such as `/api/server/$1` makes Hobby return 404 for those paths, because only the function file itself is a route.

The server turns those two REST variables into that database’s `rediss://` address and keeps one connection open. If that port cannot be reached, it uses the Upstash REST API and polls about once a second while peers are connected. Presence is refreshed every 30 seconds, not on every PeerJS heartbeat, so a personal server stays inside the free 500,000 commands.

Hobby shares 1,024 file descriptors in the function, so the server accepts at most 200 peers at once on Vercel. A socket still closes at 300 seconds. The PeerJS client reconnects with the same id. An existing WebRTC data channel stays up across that reconnect.

`npm start` on one machine keeps presence in memory and does not need Redis. On Vercel, two peers can land on different instances, so the free Redis database is what lets them find each other.

### Paid tier, only after the free limits are tight

Stay on Hobby until a limit below is actually hit.

- Socket lifetime. Hobby stops at 300 seconds. On Pro, set `functions.api/server.js.maxDuration` in `vercel.json` to `800` (or `1800` on the Pro extended-duration beta) and redeploy. The committed file stays at `300` so a Hobby deploy is accepted.
- Redis commands. The free Upstash database rejects commands after 500,000 in a month. Upgrade that same Upstash database to pay-as-you-go. The environment variable names do not change.
- Included function usage. Hobby includes 4 CPU-hours, 360 GB-hours of provisioned memory, and 1,000,000 invocations a month. WebSockets count as function time while they are open. A busy public relay can exhaust that. Pro bills the overage. The server code stays the same.

## Install

```bash
npm install peerjs-server-vercel
npx peerjs-server-vercel
```

```js
import { createPeerServer } from 'peerjs-server-vercel';

const peer = await createPeerServer();
peer.httpServer.listen(9000);
```

## Run from a checkout

```bash
npm install
npm start
```

The default URL is `ws://127.0.0.1:9000/peerjs?key=peerjs`.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `9000` | Local listen port |
| `PEERJS_KEY` | `peerjs` | Key the client must send |
| `PEERJS_PATH` | `/` | Base path. Socket is `{path}/peerjs` |
| `ALLOW_DISCOVERY` | `false` | `GET /{key}/peers` lists connected ids |
| `REDIS_URL` | derived from the Upstash REST credentials | Shared presence and cross-instance relay |
| `UPSTASH_REDIS_REST_URL` | empty | Free Vercel Marketplace Redis endpoint |
| `UPSTASH_REDIS_REST_TOKEN` | empty | Token for that free database |
| `PEERJS_ALIVE_TIMEOUT` | `90000` | Drop a peer that stops heartbeats |
| `PEERJS_PRESENCE_TOUCH_MS` | `30000` | How often a live peer refreshes Redis |
| `PEERJS_EXPIRE_TIMEOUT` | `5000` | Drop an offer waiting for an offline peer |
| `PEERJS_CONCURRENT_LIMIT` | `5000`, or `200` on Vercel | Maximum registered peers |

Peer ids and tokens are limited to 64 characters in `[A-Za-z0-9_-]`.

## Tests

```bash
npm run test:unit
npm run test:integration
npm run test:e2e
npm test
```

`npm publish` runs the full suite first. The npm account must be logged in, and the package name `peerjs-server-vercel` is still unclaimed.
