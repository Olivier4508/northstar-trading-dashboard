# Northstar Trading Dashboard V2

Northstar is a Hyperliquid-first trading dashboard prototype focused on:

- performance stats
- realized and unrealized PnL
- open risk and exposure
- recent fills
- a prominent assistant panel
- live read-only Hyperliquid sync
- official TradingView Advanced Chart widgets
- flashing live values when tracked numbers change
- hosted/server-backed LLM assistant for portfolio/trade questions
- remembered wallet, chart layout, KPI order, and chat history
- CSV fallback import

## Run locally

Run the local server:

```bash
/Users/olivedf/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node server.js
```

Then open `http://127.0.0.1:3000`.

To enable the LLM assistant, launch with an OpenAI API key in the environment:

```bash
OPENAI_API_KEY=... /Users/olivedf/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node server.js
```

Or create a private `.env.local` file in this folder:

```text
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-4.1-mini
```

Optional:

```bash
OPENAI_MODEL=gpt-4.1-mini
```

If the app is opened directly as `index.html`, live Hyperliquid data still works, but the LLM assistant needs the local server at `http://127.0.0.1:3000`.

## Deploy live

The app is ready for Vercel-style static hosting with a serverless assistant endpoint:

- static app files are served from the project root
- the hosted LLM endpoint lives at [api/assistant.js](/Users/olivedf/Documents/Trading%20Dashboard/api/assistant.js)
- [vercel.json](/Users/olivedf/Documents/Trading%20Dashboard/vercel.json) configures the serverless function and no-store API responses
- `OPENAI_API_KEY` is stored once in the hosting provider's environment variable settings
- `OPENAI_MODEL` is optional and defaults to `gpt-4.1-mini`

On Vercel:

1. Import this project/repo.
2. Add `OPENAI_API_KEY` under Project Settings -> Environment Variables for Production and Preview.
3. Optionally add `OPENAI_MODEL`.
4. Deploy.
5. Use the live URL instead of `index.html` or the local server.

Vercel automatically serves Node functions from the `/api` directory, and environment variables are read by function code during execution.

CLI shortcut after the project is linked to a Vercel account:

```bash
npm run deploy
```

The hosted app calls `/api/assistant` automatically, so no `.env.local` or local server is needed when using the live URL.

## Quick launch on macOS

For a faster startup flow:

- double-click [launch-dashboard.sh](/Users/olivedf/Documents/Trading%20Dashboard/launch-dashboard.sh) to start the local server and open the dashboard
- run [stop-dashboard.sh](/Users/olivedf/Documents/Trading%20Dashboard/stop-dashboard.sh) to stop the local server
- compile [launcher.js](/Users/olivedf/Documents/Trading%20Dashboard/launcher.js) into a `.app` bundle and drag it to your Dock/sidebar for one-click launch

## Current V2 shape

- `index.html`: app shell
- `styles.css`: layout and visual system
- `src/mock-data.js`: demo Hyperliquid-style ledger
- `src/hyperliquid.js`: read-only Hyperliquid info endpoint and websocket adapter
- `src/app.js`: rendering, metrics, official TradingView widgets, assistant logic, live sync, CSV import
- `server.js`: static file server and secure `/api/assistant` endpoint
- `api/assistant.js`: hosted serverless LLM assistant endpoint

## Assistant memory

The browser remembers:

- last wallet address
- chart widgets and chart order
- KPI card order
- assistant conversation history

The LLM receives the current dashboard context plus the stored chat transcript visible in the app. Local fallback answers still work if the server is unavailable or `OPENAI_API_KEY` is not set.

## Hyperliquid live sync

Enter a full 42-character Hyperliquid wallet address and click `Live Sync`. The app currently:

1. fetches read-only portfolio history
2. loads recent fills and funding history
3. snapshots current positions and account state
4. loads frontend open orders
5. loads `spotClearinghouseState` so portfolio value reflects unified account balance
6. subscribes to websocket account events and refreshes the normalized ledger when updates arrive

No private key, API wallet, or signed trading request is used in this version.

## TradingView widgets

The chart section uses TradingView's official Advanced Chart widget script:

```text
https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js
```

You can:

- add charts with the `+` button
- type exact TradingView symbols such as `NASDAQ:NVDA`, `BINANCE:BTCUSDT`, or `KUCOIN:HYPEUSDT`
- use quick crypto buttons for HYPE, BTC, ETH, SOL, XRP, BNB, DOGE, SUI, AVAX, and LINK
- drag chart widgets to reorder them
- delete chart widgets with `x`
- drag KPI cards to reorder the stat grid

## Suggested Hyperliquid read-only inputs

- `info` endpoint:
  - `userFillsByTime`
  - `frontendOpenOrders`
  - `portfolio`
  - `clearinghouseState`
  - `spotClearinghouseState`
  - `userFunding`
  - `metaAndAssetCtxs`
  - `spotMetaAndAssetCtxs`
- websocket subscriptions:
  - `userFills`
  - `userFundings`
  - `userNonFundingLedgerUpdates`
  - `orderUpdates`
  - `clearinghouseState`

## CSV import contract

Expected columns:

```text
time,symbol,side,size,price,fee,realizedPnl
```

Optional:

```text
holdHours
```
