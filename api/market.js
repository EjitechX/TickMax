const API = "https://api.twelvedata.com";
const ALLOWED_INDICATORS = new Set([
  "sma","ema","wma","dema","tema","bbands","keltner","ichimoku","psar","vwap",
  "rsi","macd","stoch","stochrsi","williamsr","cci","adx","roc","mfi",
  "atr","stddev","obv","cmf","ad"
]);

export default async function handler(req, res) {
  const key = process.env.TWELVE_DATA_API_KEY;
  if (!key) return res.status(500).json({status:"error", message:"TWELVE_DATA_API_KEY is not configured on Vercel."});
  const { action="quote", symbol, interval="15min", outputsize="300", indicator, start_date, end_date } = req.query || {};
  try {
    if (action === "pairs") return res.status(200).json(await td("/forex_pairs", key, {}));
    if (action === "history") {
      if (!symbol) return res.status(400).json({status:"error",message:"symbol is required"});
      return res.status(200).json(await td("/time_series", key, {symbol, interval, outputsize, start_date, end_date, timezone:"UTC"}));
    }
    if (action === "indicator") {
      if (!symbol || !indicator) return res.status(400).json({status:"error",message:"symbol and indicator are required"});
      if (!ALLOWED_INDICATORS.has(String(indicator))) return res.status(400).json({status:"error",message:"Indicator is not enabled in TickMax."});
      return res.status(200).json(await td(`/${encodeURIComponent(indicator)}`, key, {symbol, interval, outputsize, timezone:"UTC"}));
    }
    if (action === "quote") {
      if (!symbol) return res.status(400).json({status:"error",message:"symbol is required"});
      return res.status(200).json(await td("/quote", key, {symbol:String(symbol).split(",").map(s=>s.trim()).filter(Boolean).join(",")}));
    }
    return res.status(400).json({status:"error",message:"Unknown market action."});
  } catch (e) {
    return res.status(502).json({status:"error",message:e.message||"Market data request failed."});
  }
}

async function td(path,key,params){
  const u=new URL(API+path);
  for(const [k,v] of Object.entries({...params,apikey:key})) if(v!==undefined&&v!==null&&v!=="") u.searchParams.set(k,v);
  const r=await fetch(u);
  const text=await r.text();
  let data; try{data=JSON.parse(text)}catch{throw new Error("Invalid response from Twelve Data.")}
  if(!r.ok||data.status==="error") throw new Error(data.message||`Twelve Data HTTP ${r.status}`);
  return data;
}
