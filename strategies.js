// Indicator math (MT5-compatible), candle helpers and MT5-style report metrics.
export const sma=(a,p)=>{const o=new Array(a.length).fill(null);let s=0;for(let i=0;i<a.length;i++){s+=a[i];if(i>=p)s-=a[i-p];if(i>=p-1)o[i]=s/p}return o};
// MT5 EMA: seeded with the first price, then recursive. raw=true keeps values from bar 0 (used inside MACD).
export const ema=(a,p,raw=false)=>{const k=2/(p+1),o=new Array(a.length).fill(null);let v=null;for(let i=0;i<a.length;i++){v=i===0?a[0]:a[i]*k+v*(1-k);if(raw||i>=p-1)o[i]=v}return o};
// MT5 smoothed MA (SMMA): SMA seed then (prev*(p-1)+price)/p
export const smma=(a,p)=>{const o=new Array(a.length).fill(null);let v=null;for(let i=0;i<a.length;i++){if(i===p-1)v=a.slice(0,p).reduce((x,y)=>x+y,0)/p;else if(i>=p)v=(v*(p-1)+a[i])/p;if(i>=p-1)o[i]=v}return o};
export const rsi=(a,p=14)=>{const o=new Array(a.length).fill(null);let g=0,l=0;for(let i=1;i<a.length;i++){const d=a[i]-a[i-1],u=Math.max(d,0),w=Math.max(-d,0);if(i<=p){g+=u;l+=w;if(i===p){g/=p;l/=p;o[i]=l?100-100/(1+g/l):100}}else{g=(g*(p-1)+u)/p;l=(l*(p-1)+w)/p;o[i]=l?100-100/(1+g/l):100}}return o};
// MT5 iATR: simple moving average of True Range (TR[0]=0), first value at index p-1 = sum(TR[1..p-1])/p
export const atr=(c,p=14)=>{const tr=c.map((x,i)=>i?Math.max(x.high,c[i-1].close)-Math.min(x.low,c[i-1].close):0),o=new Array(c.length).fill(null);if(c.length<p)return o;let v=0;for(let i=1;i<p;i++)v+=tr[i];v/=p;o[p-1]=v;for(let i=p;i<c.length;i++){v+=(tr[i]-tr[i-p])/p;o[i]=v}return o};
export const pipSize=s=>/JPY/.test(s)?0.01:/XAU/.test(s)?0.1:/XAG/.test(s)?0.01:0.0001;
export const toCandles=j=>(j.values||[]).slice().reverse().map(x=>({time:Math.floor(new Date(x.datetime.length<=10?x.datetime+"T00:00:00Z":x.datetime.replace(" ","T")+"Z").getTime()/1000),open:+x.open,high:+x.high,low:+x.low,close:+x.close})).filter(x=>[x.open,x.high,x.low,x.close].every(Number.isFinite));

// Parses MT5 exports: History Center CSV (2025.01.02,00:00,o,h,l,c,tv,v) and Symbols>Bars export (tab separated, <DATE> <TIME> ... <SPREAD>)
export function parseMT5csv(text){
 const lines=text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);if(!lines.length)throw Error("The file is empty.");
 let cols=null;const out=[];
 for(const line of lines){
  const t=line.split(/[\t,;]/).map(s=>s.trim());
  if(t[0].startsWith("<")){cols=t.map(s=>s.replace(/[<>]/g,"").toUpperCase());continue}
  const m=t[0].match(/^(\d{4})[.\-/](\d{2})[.\-/](\d{2})$/);if(!m)continue;
  let k=1,h=0,mi=0,sec=0;const tm=(t[1]||"").match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);if(tm){h=+tm[1];mi=+tm[2];sec=+(tm[3]||0);k=2}
  const o=+t[k],hi=+t[k+1],lo=+t[k+2],cl=+t[k+3];if(![o,hi,lo,cl].every(Number.isFinite))continue;
  const c={time:Math.floor(Date.UTC(+m[1],+m[2]-1,+m[3],h,mi,sec)/1000),open:o,high:hi,low:lo,close:cl};
  if(cols){const si=cols.indexOf("SPREAD");const sp=si>=0?Number(t[si]):NaN;if(Number.isFinite(sp))c.spreadPts=sp}
  out.push(c);
 }
 if(out.length<60)throw Error("Could not read candles. Export bars from MT5 (Symbols > Bars > Export, or History Center > Export) and try again.");
 out.sort((a,b)=>a.time-b.time);return out.filter((c,i)=>!i||c.time!==out[i-1].time);
}

// MT5 Strategy Tester report style statistics
export function metrics(t,eq,start){
 const w=t.filter(x=>x.pnl>0),l=t.filter(x=>x.pnl<=0),gp=w.reduce((s,x)=>s+x.pnl,0),gl=-l.reduce((s,x)=>s+x.pnl,0),n=t.length,net=t.reduce((s,x)=>s+x.pnl,0);
 let peak=start,ddAbs=0,ddMaxPct=0,relPct=0,relAbs=0,minEq=start;
 eq.forEach(e=>{minEq=Math.min(minEq,e.value);peak=Math.max(peak,e.value);const d=peak-e.value,p=peak>0?d/peak*100:0;if(d>ddAbs){ddAbs=d;ddMaxPct=p}if(p>relPct){relPct=p;relAbs=d}});
 const runs=[];let cur=null;t.forEach(x=>{const win=x.pnl>0;if(cur&&cur.win===win){cur.n++;cur.sum+=x.pnl}else{cur={win,n:1,sum:x.pnl};runs.push(cur)}});
 const W=runs.filter(r=>r.win),L=runs.filter(r=>!r.win),pick=(a,f)=>a.length?a.reduce((b,r)=>f(r,b)?r:b):{n:0,sum:0};
 const longs=t.filter(x=>x.dir>0),shorts=t.filter(x=>x.dir<0),avg=a=>a.length?a.reduce((s,r)=>s+r.n,0)/a.length:0;
 return {net,ret:net/start*100,final:start+net,trades:n,wins:w.length,losses:l.length,winRate:n?w.length/n*100:0,pf:gl?gp/gl:(gp?Infinity:0),
  avgWin:w.length?gp/w.length:0,avgLoss:l.length?-gl/l.length:0,expectancy:n?net/n:0,
  maxDD:relPct,maxDDAbs:ddAbs,ddMaxPct,relAbs,absDD:Math.max(0,start-minEq),recovery:ddAbs?net/ddAbs:0,
  best:n?Math.max(...t.map(x=>x.pnl)):0,worst:n?Math.min(...t.map(x=>x.pnl)):0,
  longs:longs.length,shorts:shorts.length,longWon:longs.filter(x=>x.pnl>0).length,shortWon:shorts.filter(x=>x.pnl>0).length,
  maxConsecWins:pick(W,(r,b)=>r.n>b.n),maxConsecLoss:pick(L,(r,b)=>r.n>b.n),maxConsecProfit:pick(W,(r,b)=>r.sum>b.sum),maxConsecLossAmt:pick(L,(r,b)=>r.sum<b.sum),
  avgConsecWins:avg(W),avgConsecLoss:avg(L),commission:t.reduce((s,x)=>s+(x.commission||0),0),
  avgBars:n?t.reduce((s,x)=>s+x.bars,0)/n:0,gp,gl};
}
