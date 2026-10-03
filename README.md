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
