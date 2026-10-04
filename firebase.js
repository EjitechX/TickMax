import { initializeApp } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js";
import { getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, collection, addDoc, query, orderBy, limit, getDocs, serverTimestamp, runTransaction, deleteDoc } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCsOqoq-SZtrn5o-EyygBSiwtRzm4h2KI4",
  authDomain: "tickmax.firebaseapp.com",
  projectId: "tickmax",
  storageBucket: "tickmax.firebasestorage.app",
  messagingSenderId: "156166245269",
  appId: "1:156166245269:web:4656a2ad8381239a4c049c",
  measurementId: "G-XLGYM0VZHR"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

function accountRef(uid, accountId) { return doc(db, "users", uid, "accounts", accountId); }
function tradesCol(uid, accountId) { return collection(db, "users", uid, "accounts", accountId, "trades"); }

async function createUserProfile(user, accountSpec = {}) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      email: user.email || "",
      createdAt: serverTimestamp(),
      settings: { defaultSymbol: "XAU/USD", defaultTimeframe: "15min" }
    });
  }
  const existing = await getDocs(query(collection(db, "users", user.uid, "accounts"), limit(1)));
  if (existing.empty) {
    const oldBalance = Number(snap.data()?.paperAccount?.balance);
    const migratedBalance = Number.isFinite(oldBalance) && oldBalance > 0 ? oldBalance : Number(accountSpec.initialBalance);
    return createPaperAccount(user.uid, {
      name: accountSpec.name || "Demo Account",
      initialBalance: Number.isFinite(migratedBalance) && migratedBalance > 0 ? migratedBalance : 1000
    });
  }
  return existing.docs[0].id;
}

async function createPaperAccount(uid, spec = {}) {
  const name = String(spec.name || "Demo Account").trim().slice(0, 40) || "Demo Account";
  const initialBalance = Number(spec.initialBalance);
  if (!Number.isFinite(initialBalance) || initialBalance < 10 || initialBalance > 5000000) throw new Error("Paper deposit must be between $10 and $5,000,000.");
  const ref = doc(collection(db, "users", uid, "accounts"));
  await setDoc(ref, {
    name,
    initialBalance,
    balance: initialBalance,
    equity: initialBalance,
    currency: "USD",
    mode: "simulation",
    algoEnabled: false,
    createdAt: serverTimestamp()
  });
  return ref.id;
}

async function getAccounts(uid) {
  const snap = await getDocs(query(collection(db, "users", uid, "accounts"), orderBy("createdAt", "asc")));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function getUserProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data() : null;
}

async function setAlgoEnabled(uid, accountId, enabled) {
  await updateDoc(accountRef(uid, accountId), { algoEnabled: !!enabled });
}

async function getPaperTrades(uid, accountId) {
  const q = query(tradesCol(uid, accountId), orderBy("createdAt", "desc"), limit(100));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function placePaperTrade(uid, accountId, trade) {
  const userRef = accountRef(uid, accountId);
  const tradeRef = doc(tradesCol(uid, accountId));
  return runTransaction(db, async tx => {
    const snap = await tx.get(userRef);
    if (!snap.exists()) throw new Error("Paper account not found.");
    const account = snap.data();
    const balance = Number(account.balance || 0);
    const quantity = Number(trade.quantity);
    const price = Number(trade.price);
    const side = trade.side === "SELL" ? "SELL" : "BUY";
    if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(price) || price <= 0) throw new Error("Invalid paper order.");
    const notional = quantity * price;
    const leverage = Number(trade.leverage) > 0 ? Number(trade.leverage) : 1;
    const baseUSD = trade.baseUSD === true;
    const margin = baseUSD ? quantity / leverage : notional / leverage;
    if (margin > balance) throw new Error("Insufficient paper margin for this order.");
    tx.set(tradeRef, {
      symbol: trade.symbol,
      name: trade.name || trade.symbol,
      side, quantity, price, notional, margin, leverage, baseUSD,
      status: "OPEN",
      source: trade.source || "MANUAL",
      stopLoss: trade.stopLoss ?? null,
      takeProfit: trade.takeProfit ?? null,
      createdAt: serverTimestamp()
    });
    tx.update(userRef, { balance: balance - margin, equity: balance - margin });
    return tradeRef.id;
  });
}

async function updatePaperTradeStops(uid, accountId, tradeId, stopLoss, takeProfit) {
  const tradeRef = doc(tradesCol(uid, accountId), tradeId);
  return updateDoc(tradeRef, { stopLoss: stopLoss || null, takeProfit: takeProfit || null });
}

async function closePaperTrade(uid, accountId, tradeId, currentPrice) {
  const userRef = accountRef(uid, accountId);
  const tradeRef = doc(tradesCol(uid, accountId), tradeId);
  return runTransaction(db, async tx => {
    const [accountSnap, tradeSnap] = await Promise.all([tx.get(userRef), tx.get(tradeRef)]);
    if (!accountSnap.exists() || !tradeSnap.exists()) throw new Error("Trade not found.");
    const account = accountSnap.data();
    const trade = tradeSnap.data();
    if (trade.status !== "OPEN") throw new Error("Trade is already closed.");
    const exit = Number(currentPrice);
    const entry = Number(trade.price);
    const qty = Number(trade.quantity);
    if (!Number.isFinite(exit) || exit <= 0) throw new Error("No valid market price is available.");
    const raw = trade.side === "SELL" ? (entry - exit) * qty : (exit - entry) * qty;
    const pnl = trade.baseUSD ? raw / exit : raw;
    const nextBalance = Number(account.balance || 0) + Number(trade.margin ?? trade.notional ?? entry * qty) + pnl;
    tx.update(tradeRef, { status: "CLOSED", exitPrice: exit, pnl, closedAt: serverTimestamp() });
    tx.update(userRef, { balance: nextBalance, equity: nextBalance });
    return { pnl, nextBalance };
  });
}

export {
  app, auth, db, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signOut, sendPasswordResetEmail, createUserProfile, getUserProfile,
  createPaperAccount, getAccounts, setAlgoEnabled, getPaperTrades,
  placePaperTrade, closePaperTrade, updatePaperTradeStops
};
