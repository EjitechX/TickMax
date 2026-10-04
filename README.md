# TickMax

TickMax is a mobile-first market analysis and paper-trading terminal. Version 1.0.0 is simulation-only: it does not execute real-money trades.

## Stack
- Static mobile web app on Vercel
- Firebase Authentication + Firestore for protected paper accounts
- Twelve Data through `/api/market` Vercel serverless proxy
- Lightweight Charts for market charts
- Installable PWA shell

## Repository layout
```text
index.html
app.js
style.css
firebase.js
firestore.rules
vercel.json
manifest.webmanifest
sw.js
api/market.js
assets/tickmax-logo.png
assets/tickmax-og.png
assets/tickmax-icon-512.png
```

## Vercel environment variable
Create this server-side variable in the TickMax Vercel project:

`TWELVE_DATA_API_KEY`

Keep it in Vercel Environment Variables. Do not put the Twelve Data secret in browser code or GitHub.

## Firebase
Enable Email/Password Authentication and deploy the included `firestore.rules` to the TickMax Firebase project.

## Deployment
Connect the GitHub repository to the Vercel project. Every commit to the connected production branch creates a new deployment.

## Paper trading
All orders and balances are simulation data stored under the authenticated user's Firestore account. There is no live brokerage execution.

## Backtest accuracy vs MT5
TickMax uses MT5's formulas for EMA/SMA/SMMA/LWMA, RSI, ATR, MACD, Bollinger Bands and Stochastic, charges spread on bid/ask, supports commission, contract size and USD conversion for USD/xxx pairs.
It cannot be tick-identical to MT5. Differences to expect:
- Candles: Twelve Data is not your broker's feed. Load your broker's candles (MT5 > Symbols > Bars > Export) for the closest match.
- Model: EAs run once per new bar (like MT5 "Open prices only"). Intrabar SL/TP use bar high/low and assume the stop is hit first if both are touched. Tick-level EAs (scalpers, grids, tick trailing) will differ.
- Not modelled: swaps, slippage, requotes, market-closed gaps, cross-pair USD conversion.
Always confirm a result in the MT5 Strategy Tester before trading it.
