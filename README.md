# peerjs-server-vercel

[![CodSpeed](https://img.shields.io/endpoint?url=https://codspeed.io/badge.json)](https://app.codspeed.io/jose-compu/peerjs-server-vercel?utm_source=badge)

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
4. Connect the database to this project for Production, Preview, and Development. Leave `autoUpgrade` off. Vercel writes `REDIS_URL` and the REST credentials. Do not buy a second Redis.
5. Deploy. The signaling URL is `wss://YOUR-DEPLOYMENT.vercel.app/peerjs?key=peerjs`.
6. Run the checks below. A green `/` alone does not mean the server is usable.

### Checks after deploy

| Request | Working result | If it fails |
| --- | --- | --- |
| `GET /` | JSON `name` is `peerjs-server-vercel` | The function did not deploy. |
| `GET /health` | `"status": "ok"`, `"redis": true`, `"redisMode": "tcp"` or `"upstash"` | See the routing and Redis notes below. |
| `GET /peerjs/id` | A plain-text id | Same routing failure as `/health`. |
| `wss://…/peerjs?key=peerjs&id=…&token=…` | First frame is `{"type":"OPEN"}` | Fluid compute is off, or the rewrite never reached the function. |

`redisMode` is `tcp` when the Upstash TCP port connected, `upstash` when the server fell back to the REST API, and `memory` when no Redis credentials were found. `memory` is correct for `npm start` on one machine. On Vercel it means two peers on different instances cannot see each other.

A Vercel failure is `text/plain`, body `The page could not be found`, header `x-vercel-error: NOT_FOUND`. That response is generated at the edge and never enters `api/server.js`. The server’s own errors are JSON.

### Lessons from deploying on Hobby

**One function, and the rewrite must not append the public path.** Vercel serves `api/server.js` only at `/api/server`. `vercel.json` rewrites `/(.*)` to that exact destination and leaves `/health`, `/peerjs/id`, and `/peerjs` on the request. Destination `/api/server/$1` looks like a normal rewrite and still returns 200 for `GET /`, because the empty capture lands on the function. `/health` becomes `/api/server/health`, which is not a function, so Hobby answers 404 and the WebSocket never opens. Do not “fix” that 404 by adding more files under `api/`.

**A project that only depends on the npm package must carry its own root `vercel.json` and `api/server.js`.** Vercel does not read those files from `node_modules`. Copy the rewrite and the 300-second limit from this repository:

```js
import { createPeerServer } from 'peerjs-server-vercel';

const peer = await createPeerServer();

export const config = { maxDuration: 300 };
export default peer.httpServer;
```

**Keep `maxDuration` at 300 in both places.** Hobby rejects a deploy whose function limit is above 300 seconds. The two places are `functions` in `vercel.json` and `export const config` in `api/server.js`. Raising either one is a Pro change, done only after you are on Pro. The socket still ends at that limit. The PeerJS client reconnects with the same id and token and must receive `{"type":"OPEN"}` again; an existing WebRTC data channel stays up across that reconnect.

**Install one free Upstash database, and keep it free.** In the Marketplace integration set region `us-east-1` (`iad1`, next to Vercel’s default), the free plan, `autoUpgrade` off, and no production pack. `autoUpgrade` left on can move that database onto a paid plan when usage grows. The integration writes `REDIS_URL`, `KV_URL`, `KV_REST_API_URL`, `KV_REST_API_TOKEN`, and usually `UPSTASH_REDIS_REST_URL` plus `UPSTASH_REDIS_REST_TOKEN`. The server uses `REDIS_URL`, then `UPSTASH_REDIS_URL`, then `KV_URL`. If none of those is set, it builds a `rediss://` URL from the REST host and token. Do not commit any of those values.

The TCP connection is preferred. If that port cannot be reached, the server uses the Upstash REST API and polls about once a second, and only while this instance has peers. Presence is written every 30 seconds, not on every PeerJS heartbeat, so a personal server stays inside the free 500,000 commands per month.

**Leave every other Vercel product off.** Postgres, Blob, KV as its own product, Edge Config, Cron, Queues, and Secure Compute are unused. Adding them does not make signaling work and can start a paid meter.

**Fluid compute has to be on.** Projects created after 23 April 2025 already have it. Older projects: Settings → Functions → Fluid compute. Without it the WebSocket upgrade fails even when `/health` is fine.

Hobby shares 1,024 file descriptors in the function, so the server accepts at most 200 peers at once on Vercel (`VERCEL=1`). A local process keeps the default of 5,000. `npm start` on one machine keeps presence in memory and does not need Redis. On Vercel, two peers can land on different instances, so the free Redis database is what lets them find each other.

### Paid tier, only after the free limits are tight

Stay on Hobby until a limit below is actually hit.

- Socket lifetime. Hobby stops at 300 seconds. On Pro, set `maxDuration` to `800` in both `vercel.json` and `api/server.js` (or `1800` on the Pro extended-duration beta) and redeploy. The committed files stay at `300` so a Hobby deploy is accepted.
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
| `REDIS_URL` | empty, else `UPSTASH_REDIS_URL`, else `KV_URL`, else a `rediss://` URL built from the REST host and token | Shared presence and cross-instance relay. The Marketplace sets `REDIS_URL` and `KV_URL`. |
| `UPSTASH_REDIS_REST_URL` | else `KV_REST_API_URL` | Free Upstash REST endpoint. Used when TCP cannot connect. |
| `UPSTASH_REDIS_REST_TOKEN` | else `KV_REST_API_TOKEN` | Token for that REST endpoint. |
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

`npm publish` runs the full suite first. The npm account must be logged in as a maintainer of `peerjs-server-vercel`.

## Benchmarks

```bash
npm run bench
```

The benchmarks in `bench/` use Vitest and cover path routing, config parsing, the memory and Redis directories, the relays, the Upstash REST client, and the HTTP routes. CI runs them on [CodSpeed](https://app.codspeed.io/jose-compu/peerjs-server-vercel) for every push to `main` and every pull request.
