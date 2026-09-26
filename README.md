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

1. Import this repository in Vercel. Fluid compute is on for projects created after 23 April 2025. Turn it on if this project is older.
2. Add an Upstash Redis database from the Vercel Marketplace and set `REDIS_URL`. Vercel can place each socket on a different instance. Redis is how an offer from one instance reaches a peer on another.
3. Deploy. The signaling URL is `wss://YOUR-DEPLOYMENT.vercel.app/peerjs?key=peerjs`.

A socket stays open only until the function reaches its max duration. The PeerJS client reconnects. An existing WebRTC data channel stays up across that reconnect. On a Pro plan you can raise the cap in `vercel.json`:

```json
{
  "functions": {
    "api/server.js": {
      "maxDuration": 300
    }
  }
}
```

Without `REDIS_URL`, presence stays in memory. That is enough for `npm start` on one machine. It is not enough for a Vercel deployment with more than one instance.

## Run locally

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
| `REDIS_URL` | empty | Shared presence and cross-instance relay |
| `PEERJS_ALIVE_TIMEOUT` | `90000` | Drop a peer that stops heartbeats |
| `PEERJS_EXPIRE_TIMEOUT` | `5000` | Drop an offer waiting for an offline peer |
| `PEERJS_CONCURRENT_LIMIT` | `5000` | Maximum registered peers |

Peer ids and tokens are limited to 64 characters in `[A-Za-z0-9_-]`.

## Tests

```bash
npm test
```
