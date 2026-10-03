# TickMax — Vercel + Firebase + Twelve Data

TickMax is a mobile-first paper trading terminal. It uses Firebase for authentication and cloud paper-account data, Twelve Data for market data/technical indicators, and Vercel Functions as the secure server-side proxy for the Twelve Data API key.

## Vercel setup

1. Import this project into Vercel.
2. In **Vercel → Project → Settings → Environment Variables**, add:
   - `TWELVE_DATA_API_KEY` = your Twelve Data API key
   - Apply it to Production (and Preview/Development if needed).
3. Treat the Twelve Data key as a **Secret**, not a public frontend variable.
4. Redeploy after adding/changing the variable.

Vercel serves `api/market.js` at `/api/market` and TickMax uses these actions:
- `/api/market?action=quote&symbol=EUR/USD`
- `/api/market?action=history&symbol=EUR/USD&interval=15min&outputsize=300`
- `/api/market?action=pairs`
- `/api/market?action=indicator&indicator=rsi&symbol=EUR/USD&interval=15min&outputsize=300`

## Firebase

The Firebase web configuration is in `firebase.js`. Firebase Authentication uses Email/Password and Firestore stores user profiles, multiple paper accounts, trades, and account settings.

Publish `firestore.rules` in Firebase before using the cloud account features.

## Version 1.0.0 indicators

TickMax includes a curated set of important Twelve Data technical indicators:

**Trend/overlays:** SMA, EMA, WMA, DEMA, TEMA, Bollinger Bands, Keltner Channel, Ichimoku Cloud, Parabolic SAR, VWAP.

**Momentum/trend strength:** RSI, MACD, Stochastic, Stoch RSI, Williams %R, CCI, ADX, ROC, MFI.

**Volatility:** ATR, Standard Deviation.

**Volume/flow:** OBV, CMF, Accumulation/Distribution.

The indicator panel supports search and lets the user enable/disable indicators. Indicator results are requested only when selected, which avoids loading every indicator for every chart. Each Twelve Data technical-indicator request can consume API credits.

## Important

TickMax is paper/simulation software. It does not connect to a real-money brokerage account or execute real-money trades.
