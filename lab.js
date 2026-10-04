// Backtest lab + Expert Advisor manager UI
import {toCandles,pipSize,parseMT5csv} from "./strategies.js";
import {compileEA,backtestEA,makeApi,EA_EXAMPLE,looksLikeMQL,CONTRACT,usdConv} from "./ea-runtime.js";
import {BUILTIN} from "./builtin-eas.js";
const $=id=>document.getElementById(id), enc=encodeURIComponent;
const TFS=[["1min","1m"],["5min","5m"],["15min","15m"],["30min","30m"],["1h","1H"],["4h","4H"],["1day","1D"],["1week","1W"]];
const fmt=(v,d=2)=>Number.isFinite(v)?v.toLocaleString("en-US",{minimumFractionDigits:d,maximumFractionDigits:d}):"∞";
const dt=t=>new Date(t*1000).toISOString().slice(0,16).replace("T"," ");
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const COLORS={up:"#15df91",down:"#ff5364",gold:"#f5b91b"};
const chartOpts=()=>({autoSize:true,layout:{background:{color:"#071321"},textColor:"#8195aa",attributionLogo:false},grid:{vertLines:{color:"#0e2036"},horzLines:{color:"#0e2036"}},rightPriceScale:{borderColor:"#17304d"},timeScale:{borderColor:"#17304d",timeVisible:true},crosshair:{mode:1}});
const inputHtml=(attr,k,v)=>typeof v==="boolean"?`<label>${esc(k)}<select ${attr}="${esc(k)}" data-t="boolean"><option value="true"${v?" selected":""}>true</option><option value="false"${!v?" selected":""}>false</option></select></label>`:`<label>${esc(k)}<input ${attr}="${esc(k)}" data-t="${typeof v}" ${typeof v==="number"?'type="number" step="any"':'type="text"'} value="${esc(v)}"></label>`;
const readVal=el=>el.dataset.t==="boolean"?el.value==="true":el.dataset.t==="number"?Number(el.value):el.value;

export function initLab(env){
 let eqChart=null,pxChart=null,last=null,busy=false,csv=null;
 // ---------- EA store (built-in + imported, each with its own inputs) ----------
 const load=()=>{try{return JSON.parse(localStorage.getItem("tickmax-eas2")||"[]")}catch{return[]}};
 const getEAs=()=>{const st=load(),by=Object.fromEntries(st.map(x=>[x.id,x]));
  const base=BUILTIN.map(b=>({...b,builtin:true,symbol:"XAU/USD",tf:"15min",on:false,...by[b.id],name:b.name,code:b.code,desc:b.desc,inputs:{...b.inputs,...(by[b.id]?.inputs||{})}}));
  return [...base,...st.filter(x=>!x.builtin&&!BUILTIN.some(b=>b.id===x.id))]};
 const saveEAs=a=>localStorage.setItem("tickmax-eas2",JSON.stringify(a.map(x=>x.builtin?{id:x.id,builtin:true,symbol:x.symbol,tf:x.tf,on:x.on,inputs:x.inputs}:x)));
 const patch=(id,fn)=>{const a=getEAs();fn(a.find(x=>x.id===id));saveEAs(a)};
 const cache={};const getEA=c=>{const k=c.id+":"+c.code.length;return cache[k]||(cache[k]=compileEA(c.code))};
 const tfOpts=sel=>TFS.map(([v,l])=>`<option value="${v}"${v===sel?" selected":""}>${l}</option>`).join("");
 function eaSelect(keep){const v=keep||$("btEa").value;$("btEa").innerHTML=getEAs().map(c=>`<option value="${c.id}">${esc(c.name)}${c.builtin?"":" (imported)"}</option>`).join("");if(v&&getEAs().some(c=>c.id===v))$("btEa").value=v}

 // ---------- Backtest UI ----------
 $("btTf").innerHTML=tfOpts("15min");
 $("btTo").value=new Date().toISOString().slice(0,10);$("btFrom").value=new Date(Date.now()-90*864e5).toISOString().slice(0,10);
 function renderParams(id,vals){const c=getEAs().find(x=>x.id===id);if(!c)return;$("btDesc").textContent=c.desc||"Imported EA: runs exactly as coded. Lots, stops and exits come from the EA's own inputs.";
  const v={...c.inputs,...(vals||{})};$("btParams").innerHTML=Object.entries(v).map(([k,d])=>inputHtml("data-p",k,d)).join("")}
 eaSelect("b-ema");renderParams($("btEa").value);$("btEa").onchange=e=>renderParams(e.target.value);
 const readParams=()=>Object.fromEntries([...$("btParams").querySelectorAll("[data-p]")].map(i=>[i.dataset.p,readVal(i)]));
 document.querySelectorAll("[data-bt]").forEach(b=>b.onclick=()=>{document.querySelectorAll("[data-bt]").forEach(x=>x.classList.toggle("active",x===b));document.querySelectorAll(".bt-pane").forEach(p=>p.classList.toggle("hidden",p.id!=="btPane-"+b.dataset.bt))});
 $("btFull").onclick=async()=>{try{await document.documentElement.requestFullscreen();await screen.orientation.lock("landscape")}catch{env.openGeneric("Rotate your phone","Turn your phone sideways for the full tester layout. Your browser blocked automatic rotation.")}};
 $("btCsv").onchange=async e=>{const f=e.target.files[0];if(!f)return;try{const cs=parseMT5csv(await f.text());csv={name:f.name,candles:cs};
  $("btCsvName").textContent=`MT5 candles: ${f.name} · ${cs.length.toLocaleString()} bars · ${dt(cs[0].time)} → ${dt(cs.at(-1).time)}${cs.some(c=>c.spreadPts!=null)?" · recorded spread used":""}`}catch(err){env.openGeneric("Could not read candles",err.message)}e.target.value=""};
 $("btCsvClear").onclick=()=>{csv=null;$("btCsvName").textContent="Twelve Data (default). For results closest to MT5, load your broker's own candles."};

 async function run(){
  const st=$("btStatus"),btn=$("runBacktest");btn.disabled=true;
  try{
   const symbol=$("btSymbol").value.trim().toUpperCase(),tf=$("btTf").value,c=getEAs().find(x=>x.id===$("btEa").value);if(!c)throw Error("Choose an Expert Advisor.");
   let candles;
   if(csv){const from=Date.parse($("btFrom").value+"T00:00:00Z")/1000,to=Date.parse($("btTo").value+"T23:59:59Z")/1000;candles=csv.candles.filter(x=>x.time>=from&&x.time<=to);if(candles.length<60)candles=csv.candles}
   else{st.textContent="Loading historical candles…";candles=toCandles(await env.api(`/api/history?symbol=${enc(symbol)}&interval=${tf}&outputsize=5000&start_date=${$("btFrom").value}&end_date=${$("btTo").value}`))}
   if(candles.length<60)throw Error("Not enough candles for this range. Widen the dates or use a larger timeframe.");
   st.textContent=`Running on ${candles.length.toLocaleString()} candles…`;await new Promise(r=>setTimeout(r,30));
   const cfg={symbol,pip:pipSize(symbol),spreadPts:+$("btSpread").value||0,commission:+$("btComm").value||0,contract:+$("btContract").value||0,balance:Math.max(10,+$("btBalance").value||1000),leverage:+$("btLev").value||100,inputs:readParams()};
   last={...backtestEA(getEA(c),candles,cfg),cfg,symbol,tf:csv?"MT5":tf,name:c.name};draw();
   st.textContent=`${c.name} · ${symbol} · ${candles.length.toLocaleString()} candles · ${dt(candles[0].time)} → ${dt(candles.at(-1).time)}${csv?" · MT5 data":""}`;
  }catch(e){st.textContent=e.message}finally{btn.disabled=false}
 }
 $("runBacktest").onclick=run;
 const cls=v=>v>=0?"up":"down",sign=v=>v>=0?"+":"";
 function draw(){
  const m=last.metrics,M=v=>v<0?"-"+env.money(-v):env.money(v);
  $("btKpis").innerHTML=[["Net profit",`<b class="${cls(m.net)}">${sign(m.net)}${M(m.net)}</b>`],["Gross profit",`<b class="up">${M(m.gp)}</b>`],["Gross loss",`<b class="down">${M(-m.gl)}</b>`],["Profit factor",`<b>${fmt(m.pf)}</b>`],["Max drawdown",`<b class="down">${fmt(m.maxDD)}%</b>`],["Trades",`<b>${m.trades}</b>`]].map(([k,v])=>`<div class="kpi"><small>${k}</small>${v}</div>`).join("");
  const row=(k,v)=>`<div><span>${k}</span><b>${v}</b></div>`,pct=(a,b)=>b?`${a} (${fmt(a/b*100,2)}%)`:`${a}`;
  $("btStats").innerHTML=[["Initial deposit",M(last.cfg.balance)],["Final balance",M(m.final)],["Return",`${sign(m.ret)}${fmt(m.ret)}%`],["Win rate",`${fmt(m.winRate,1)}%`],["Expected payoff",M(m.expectancy)],["Recovery factor",fmt(m.recovery)],["Max drawdown (amount)",M(m.maxDDAbs)]].map(([k,v])=>row(k,v)).join("");
  $("btReport").innerHTML=[["Total net profit",M(m.net)],["Gross profit",M(m.gp)],["Gross loss",M(-m.gl)],["Profit factor",fmt(m.pf)],["Expected payoff",M(m.expectancy)],["Recovery factor",fmt(m.recovery)],["Total commission",M(m.commission)],
   ["Balance drawdown absolute",M(m.absDD)],["Equity drawdown maximal",`${M(m.maxDDAbs)} (${fmt(m.ddMaxPct)}%)`],["Equity drawdown relative",`${fmt(m.maxDD)}% (${M(m.relAbs)})`],
   ["Total trades",m.trades],["Short trades (won %)",pct(m.shortWon,m.shorts).replace(/^(\d+) \((.*)\)$/,`${m.shorts} ($2)`)],["Long trades (won %)",pct(m.longWon,m.longs).replace(/^(\d+) \((.*)\)$/,`${m.longs} ($2)`)],
   ["Profit trades (% of total)",`${m.wins} (${fmt(m.winRate)}%)`],["Loss trades (% of total)",`${m.losses} (${fmt(m.trades?100-m.winRate:0)}%)`],
   ["Largest profit trade",M(m.best)],["Largest loss trade",M(m.worst)],["Average profit trade",M(m.avgWin)],["Average loss trade",M(m.avgLoss)],
   ["Maximum consecutive wins ($)",`${m.maxConsecWins.n} (${M(m.maxConsecWins.sum)})`],["Maximum consecutive losses ($)",`${m.maxConsecLoss.n} (${M(m.maxConsecLoss.sum)})`],
   ["Maximal consecutive profit (count)",`${M(m.maxConsecProfit.sum)} (${m.maxConsecProfit.n})`],["Maximal consecutive loss (count)",`${M(m.maxConsecLossAmt.sum)} (${m.maxConsecLossAmt.n})`],
   ["Average consecutive wins",fmt(m.avgConsecWins,0)],["Average consecutive losses",fmt(m.avgConsecLoss,0)],["Average bars in trade",fmt(m.avgBars,1)]].map(([k,v])=>row(k,v)).join("");
  $("btJournal").textContent=last.log&&last.log.length?last.log.join("\n"):"No Print() output or warnings.";
  if(eqChart)eqChart.remove();eqChart=LightweightCharts.createChart($("btEquity"),chartOpts());
  const e=eqChart.addAreaSeries({lineColor:COLORS.gold,topColor:"rgba(245,185,27,.28)",bottomColor:"rgba(245,185,27,0)",lineWidth:2});e.setData(last.equity);
  e.createPriceLine({price:last.cfg.balance,color:"#52708f",lineStyle:2,lineWidth:1,title:"Start"});eqChart.timeScale().fitContent();
  if(pxChart)pxChart.remove();pxChart=LightweightCharts.createChart($("btPrice"),chartOpts());
  const s=pxChart.addCandlestickSeries({upColor:COLORS.up,downColor:COLORS.down,borderVisible:false,wickUpColor:COLORS.up,wickDownColor:COLORS.down});s.setData(last.candles.map(({time,open,high,low,close})=>({time,open,high,low,close})));
  const mk=[];last.trades.forEach(t=>{mk.push({time:t.time,position:t.dir>0?"belowBar":"aboveBar",color:t.dir>0?COLORS.up:COLORS.down,shape:t.dir>0?"arrowUp":"arrowDown",text:t.dir>0?"B":"S"});mk.push({time:t.exitTime,position:t.dir>0?"aboveBar":"belowBar",color:t.pnl>=0?COLORS.up:COLORS.down,shape:"circle",text:t.why})});
  mk.sort((a,b)=>a.time-b.time);s.setMarkers(mk);pxChart.timeScale().fitContent();
  $("btTable").innerHTML=`<thead><tr><th>#</th><th>Type</th><th>Lots</th><th>Open</th><th>Entry</th><th>Close</th><th>Exit</th><th>Why</th><th>P/L</th><th>Balance</th></tr></thead><tbody>${last.trades.map((t,i)=>`<tr><td>${i+1}</td><td class="${t.dir>0?"up":"down"}">${t.dir>0?"BUY":"SELL"}</td><td>${fmt(t.lots)}</td><td>${dt(t.time)}</td><td>${fmt(t.entry,5)}</td><td>${dt(t.exitTime)}</td><td>${fmt(t.exit,5)}</td><td>${t.why}</td><td class="${cls(t.pnl)}">${sign(t.pnl)}${fmt(t.pnl)}</td><td>${fmt(t.balance)}</td></tr>`).join("")||'<tr><td colspan="10">No trades were triggered.</td></tr>'}</tbody>`;
 }

 // ---------- Expert Advisors ----------
 function renderEAs(){
  $("eaList").innerHTML=getEAs().map(c=>`<div class="card ea-card" data-ea="${esc(c.id)}">
   <div class="ea-top"><div class="ea-icon">EA</div><div class="ea-name"><b>${esc(c.name)}</b><small>${esc(c.desc||"Imported · runs exactly as coded")}</small></div><button class="mini-toggle${c.on?" on":""}" data-act="toggle" aria-pressed="${c.on}"><span></span></button></div>
   <div class="ea-chips"><span>${esc(c.symbol)}</span><span>${TFS.find(t=>t[0]===c.tf)?.[1]||c.tf}</span>${Object.entries(c.inputs).slice(0,4).map(([k,v])=>`<span>${esc(k)} ${esc(v)}</span>`).join("")}</div>
   <details><summary>Inputs</summary><div class="grid2"><label>Symbol<input data-f="symbol" value="${esc(c.symbol)}"></label><label>Timeframe<select data-f="tf">${tfOpts(c.tf)}</select></label>${Object.entries(c.inputs).map(([k,v])=>inputHtml("data-i",k,v)).join("")}</div></details>
   <div class="ea-actions"><button class="small-btn" data-act="bt">Backtest this EA</button>${c.builtin?"":' <button class="small-btn danger" data-act="del">Remove</button>'}</div></div>`).join("");
  $("eaList").querySelectorAll(".ea-card").forEach(card=>{const id=card.dataset.ea,reopen=()=>{const o=card.querySelector("details").open;renderEAs();if(o)$("eaList").querySelector(`[data-ea="${CSS.escape(id)}"] details`).open=true};
   card.querySelector('[data-act="toggle"]').onclick=()=>{let on;patch(id,x=>{x.on=!x.on;on=x.on});renderEAs();env.log(`${getEAs().find(x=>x.id===id).name} ${on?"enabled":"disabled"}`)};
   card.querySelectorAll("[data-f],[data-i]").forEach(inp=>inp.onchange=()=>{patch(id,x=>{if(inp.dataset.f)x[inp.dataset.f]=inp.dataset.f==="symbol"?(inp.value.trim().toUpperCase()||x.symbol):inp.value;else x.inputs[inp.dataset.i]=readVal(inp)});reopen()});
   card.querySelector('[data-act="bt"]').onclick=()=>{const c=getEAs().find(x=>x.id===id);eaSelect(id);$("btEa").value=id;renderParams(id,c.inputs);$("btSymbol").value=c.symbol;$("btTf").value=c.tf;env.show("backtest");run()};
   const del=card.querySelector('[data-act="del"]');if(del)del.onclick=()=>{saveEAs(getEAs().filter(x=>x.id!==id));eaSelect();renderParams($("btEa").value);renderEAs()};
  });
 }
 function addEA(code,filename=""){
  code=code.trim();if(!code)return env.openGeneric("Nothing to add","Choose a file or paste the Expert Advisor code first.");
  if(looksLikeMQL(code,filename))return env.openGeneric("MQL5 file detected","A browser can't run MQL4/MQL5 source or compiled .ex5 files. Send the .mq5 source to Claude and ask for a TickMax EA conversion. It keeps the same entry, exit, lot and stop logic. Then import the converted file here.");
  try{const ea=compileEA(code),a=getEAs();a.push({id:"u"+Date.now().toString(36),name:ea.meta.name,code,symbol:"XAU/USD",tf:"15min",on:false,inputs:ea.meta.inputs});saveEAs(a);eaSelect();renderEAs();$("eaPaste").value="";env.log(`Imported ${ea.meta.name}`)}
  catch(e){env.openGeneric("Could not load this EA",e.message)}
 }
 $("eaFile").onchange=async e=>{const f=e.target.files[0];if(!f)return;addEA(await f.text(),f.name);e.target.value=""};
 $("eaAdd").onclick=()=>addEA($("eaPaste").value);
 $("eaExample").onclick=()=>{$("eaPaste").value=EA_EXAMPLE};
 renderEAs();

 // ---------- Live paper execution (same EA code as the backtest) ----------
 async function runLive(c,s){
  const ea=getEA(c),uid=s.currentUser.uid,aid=s.activeAccountId,source=`EA: ${c.name}`,fx=usdConv(c.symbol);
  const candles=toCandles(await env.api(`/api/history?symbol=${enc(c.symbol)}&interval=${c.tf}&outputsize=300`));if(candles.length<60)return;
  const i=candles.length-1,px=candles[i].close,contract=CONTRACT(c.symbol),LEV=100;
  let open=(await env.getTrades(uid,aid)).filter(t=>t.status==="OPEN"&&t.symbol===c.symbol&&t.source===source);
  for(const t of open.slice()){const L=t.side==="BUY",hit=L?((t.stopLoss&&px<=t.stopLoss)?"SL":(t.takeProfit&&px>=t.takeProfit)?"TP":""):((t.stopLoss&&px>=t.stopLoss)?"SL":(t.takeProfit&&px<=t.takeProfit)?"TP":"");
   if(hit){await env.closeTrade(uid,aid,t.id,px);env.log(`${hit} hit · ${t.side} ${c.symbol}`);open=open.filter(x=>x!==t)}}
  const key=`cea-${aid}-${c.id}-${c.symbol}-${c.tf}-${candles[i].time}`;if(localStorage.getItem(key))return;
  const acc=s.accounts.find(a=>a.id===aid),core={c:candles,i,symbol:c.symbol,pip:pipSize(c.symbol),cache:{},log:[]};
  const local=open.map(t=>({id:t.id,real:true,dir:t.side==="BUY"?1:-1,units:t.quantity,lots:t.quantity/contract,entry:t.price,sl:t.stopLoss||0,tp:t.takeProfit||0,time:0,comment:""}));
  let free=Number(acc.balance),n=0;const actions=[],bad=m=>{core.log.push("Order rejected: "+m);return 0},mg=p=>fx.margin(p.units,p.entry,LEV),fl=p=>fx.toUsd((px-p.entry)*p.dir*p.units,px);
  const broker={positions:()=>local,ask:()=>px,bid:()=>px,floating:fl,balance:()=>free+local.reduce((a,p)=>a+mg(p),0),equity:()=>free+local.reduce((a,p)=>a+mg(p)+fl(p),0),
   open(dir,lots,sl,tp,comment){lots=+lots;sl=+sl||0;tp=+tp||0;const units=lots*contract;if(!(lots>0))return bad("invalid lots");if((sl&&(dir>0?sl>=px:sl<=px))||(tp&&(dir>0?tp<=px:tp>=px)))return bad("invalid stops");const m=fx.margin(units,px,LEV);if(m>free)return bad("not enough margin");free-=m;const p={id:"n"+n++,real:false,dir,lots,units,entry:px,sl,tp,time:candles[i].time,comment};local.push(p);actions.push({type:"open",p});return p.id},
   close(id){const k=local.findIndex(p=>p.id===id);if(k<0)return false;const p=local.splice(k,1)[0];free+=mg(p);if(p.real)actions.push({type:"close",id});else p.removed=true;return true},
   modify(id,sl,tp){const p=local.find(x=>x.id===id);if(!p)return false;p.sl=+sl||0;p.tp=+tp||0;if(p.real)actions.push({type:"modify",p});return true}};
  const inst=ea.factory(makeApi(core,broker),{...ea.meta.inputs,...c.inputs});
  try{inst.OnInit&&inst.OnInit();inst.OnTick()}catch(e){localStorage.setItem(key,"1");env.log(`${c.name} error: ${e.message}`);return}
  for(const a of actions){
   if(a.type==="open"&&!a.p.removed){await env.placeTrade(uid,aid,{symbol:c.symbol,name:c.symbol,side:a.p.dir>0?"BUY":"SELL",quantity:a.p.units,price:px,source,stopLoss:a.p.sl||null,takeProfit:a.p.tp||null,leverage:LEV,baseUSD:fx.baseUSD});env.log(`${a.p.dir>0?"BUY":"SELL"} ${fmt(a.p.lots)} lot ${c.symbol} · ${c.name}`)}
   else if(a.type==="close"){await env.closeTrade(uid,aid,a.id,px);env.log(`Closed ${c.symbol} · ${c.name}`)}
   else if(a.type==="modify"&&env.modifyTrade)await env.modifyTrade(uid,aid,a.p.id,a.p.sl,a.p.tp)}
  core.log.forEach(m=>env.log(`${c.name}: ${m}`));localStorage.setItem(key,"1");if(actions.length)await env.refreshAccounts();
 }
 async function runEAs(){
  const s=env.state();if(busy||!s.currentUser||!s.activeAccountId)return;
  const acc=s.accounts.find(a=>a.id===s.activeAccountId);if(!acc?.algoEnabled)return;busy=true;
  try{for(const c of getEAs()){if(c.on)try{await runLive(c,s)}catch(e){env.log(`${c.name}: ${e.message}`)}}}finally{busy=false}
 }
 return {runEAs,renderEAs,refreshSymbols:pairs=>{$("btSymbols").innerHTML=["XAU/USD","XAG/USD",...pairs.map(p=>p.symbol)].map(s=>`<option value="${s}">`).join("")}};
}
