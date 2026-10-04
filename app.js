import {initLab} from "./lab.js";
import {
  auth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, sendPasswordResetEmail, createUserProfile, getAccounts, createPaperAccount, setAlgoEnabled,
  getPaperTrades, placePaperTrade, closePaperTrade, updatePaperTradeStops
} from "./firebase.js";

const APP_VERSION="1.3.0";
let deferredInstallPrompt=null;
document.querySelectorAll("[data-app-version]").forEach(el=>el.textContent=`Version ${APP_VERSION}`);
let pairs=[];
let selected="XAU/USD", selectedName="Gold / US Dollar", timeframe=localStorage.getItem("tickmax-tf")||"15min";
let chart=null, mainSeries=null, candleData=[];
let activeFilter="All", searchTerm="", currentUser=null, authMode="signin", currentQuote=0;
let accounts=[], activeAccountId=null, algoBusy=false, chartType="candles";
let activeIndicators=new Set();
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferredInstallPrompt=e; document.body.classList.add("install-available"); });
window.addEventListener("appinstalled", () => { deferredInstallPrompt=null; document.body.classList.remove("install-available"); });
const list=document.getElementById("marketList");
const special=[{s:"XAU/USD",n:"Gold / US Dollar",group:"Metals"},{s:"XAG/USD",n:"Silver / US Dollar",group:"Metals"}];
const money=v=>`$${Number(v||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const DEPOSIT_OPTIONS=[10,25,50,100,250,500,1000,3000,5000,10000,25000,50000,100000,500000,1000000,5000000];
const MIN_DEPOSIT=10,MAX_DEPOSIT=5000000;
const escapeHtml=v=>String(v).replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;","\"":"&quot;"}[c]));
const formatDeposit=v=>`$${Number(v).toLocaleString("en-US")} USD`;
const indicatorState={};
const indicatorCache=new Map();
const INDICATOR_LABELS={sma:"SMA 20",ema:"EMA 20",wma:"WMA 20",dema:"DEMA 20",tema:"TEMA 20",bbands:"Bollinger Bands",keltner:"Keltner Channel",ichimoku:"Ichimoku Cloud",psar:"Parabolic SAR",vwap:"VWAP",rsi:"RSI 14",macd:"MACD",stoch:"Stochastic",stochrsi:"Stoch RSI",williamsr:"Williams %R",cci:"CCI 20",adx:"ADX 14",roc:"ROC 12",mfi:"MFI 14",atr:"ATR 14",stddev:"StdDev 20",obv:"OBV",cmf:"CMF 20",ad:"Accumulation/Distribution"};
const INDICATOR_OVERLAYS=new Set(["sma","ema","wma","dema","tema","bbands","keltner","ichimoku","psar","vwap"]);

function setupDepositPicker(buttonId,valueId,inputId,optionsId){
  const btn=document.getElementById(buttonId),value=document.getElementById(valueId),input=document.getElementById(inputId),menu=document.getElementById(optionsId);if(!btn||!value||!input||!menu)return;
  menu.innerHTML=DEPOSIT_OPTIONS.map(v=>`<button type="button" class="deposit-option${Number(input.value)===v?' selected':''}" data-value="${v}" role="option">${v.toLocaleString('en-US')}</button>`).join("");
  const close=()=>{menu.classList.add("hidden");btn.setAttribute("aria-expanded","false")};
  btn.onclick=()=>{const opening=menu.classList.contains("hidden");document.querySelectorAll(".deposit-options").forEach(m=>m.classList.add("hidden"));document.querySelectorAll(".deposit-picker").forEach(b=>b.setAttribute("aria-expanded","false"));if(opening){menu.classList.remove("hidden");btn.setAttribute("aria-expanded","true")}};
  menu.querySelectorAll(".deposit-option").forEach(opt=>opt.onclick=()=>{const v=Number(opt.dataset.value);input.value=String(v);value.textContent=formatDeposit(v);menu.querySelectorAll(".deposit-option").forEach(x=>x.classList.toggle("selected",x===opt));close()});
  document.addEventListener("click",e=>{if(!e.target.closest(".deposit-picker-wrap"))close()});
}
function validateDeposit(value){const amount=Number(value);if(!Number.isFinite(amount)||amount<MIN_DEPOSIT||amount>MAX_DEPOSIT)throw Error("Deposit must be between $10 and $5,000,000.");return amount;}
function protectedFeature(){if(currentUser)return true;document.getElementById("loginPrompt").classList.remove("hidden");return false;}
function show(id){if(id!=="markets"&&!protectedFeature())return;document.querySelectorAll(".screen").forEach(s=>s.classList.toggle("active",s.id===id));document.querySelectorAll(".bottom-nav button").forEach(b=>b.classList.toggle("active",b.dataset.screen===id));scrollTo(0,0);}
function openGeneric(title,text){document.getElementById("genericTitle").textContent=title;document.getElementById("genericText").textContent=text;document.getElementById("genericModal").classList.remove("hidden");}
async function api(path){const r=await fetch(path);const j=await r.json();if(!r.ok||j.status==="error")throw Error(j.message||"Data request failed");return j;}


const QS={},qVis=new Set();let qObs=null,qBusy=false,qRR=0,qPause=0,qDeb=null;
function normQuotes(j){const out={},put=(x,k)=>{if(x&&typeof x==="object"&&!x.code&&(x.close!=null||x.price!=null))out[x.symbol||k]=x};if(j.symbol)put(j);else if(Array.isArray(j.data))j.data.forEach(x=>put(x));else Object.entries(j).forEach(([k,v])=>put(v,k));return out}
function fmtPx(sym,v){const n=Number(v);if(!Number.isFinite(n))return"—";const d=/JPY/.test(sym)?3:/XAU|XAG/.test(sym)?2:n>=100?3:5;return n.toFixed(d)}
function paintQuote(sym){const el=document.querySelector(`.quote[data-q="${CSS.escape(sym)}"]`),q=QS[sym];if(!el||!q)return;const p=fmtPx(sym,q.price),ch=Number(q.change),pc=Number(q.pct),cls=ch>0?"up":ch<0?"down":"";
 el.querySelector(".qp").innerHTML=p==="—"?p:`${p.slice(0,-1)}<sup>${p.slice(-1)}</sup>`;el.querySelector(".qp").className="qp "+(q.tick||"");
 const qc=el.querySelector(".qc");qc.className="qc "+cls;qc.textContent=Number.isFinite(ch)?`${ch>0?"+":""}${fmtPx(sym,ch)}  ${pc>0?"+":""}${Number.isFinite(pc)?pc.toFixed(2):"0.00"}%`:"";
 el.querySelector(".qhl").textContent=q.low!=null&&q.high!=null?`L ${fmtPx(sym,q.low)}  H ${fmtPx(sym,q.high)}`:""}
function storeQuotes(map){for(const [sym,x] of Object.entries(map)){const price=Number(x.close??x.price);if(!Number.isFinite(price))continue;const old=QS[sym];QS[sym]={price,change:x.change,pct:x.percent_change,high:x.high,low:x.low,tick:old?(price>old.price?"up":price<old.price?"down":old.tick):""};paintQuote(sym)}}
async function refreshVisibleQuotes(force){
 if(qBusy||document.hidden||!document.getElementById("markets").classList.contains("active"))return;if(!force&&Date.now()<qPause)return;
 const list=[...qVis];if(!list.length)return;const n=Math.min(8,list.length),batch=[];for(let k=0;k<n;k++)batch.push(list[(qRR+k)%list.length]);qRR+=n;
 qBusy=true;try{storeQuotes(normQuotes(await api(`/api/market?symbol=${batch.map(encodeURIComponent).join(",")}`)))}catch(e){qPause=Date.now()+60000;console.warn("Quotes:",e.message)}finally{qBusy=false}}
function qObserve(el){if(!("IntersectionObserver" in window))return;if(!qObs)qObs=new IntersectionObserver(es=>{let added=false;es.forEach(e=>{const sy=e.target.dataset.symbol;if(e.isIntersecting){if(!qVis.has(sy))added=true;qVis.add(sy)}else qVis.delete(sy)});if(added){clearTimeout(qDeb);qDeb=setTimeout(()=>refreshVisibleQuotes(),400)}});qObs.observe(el)}
setInterval(()=>refreshVisibleQuotes(),15000);document.addEventListener("visibilitychange",()=>{if(!document.hidden)refreshVisibleQuotes()});
function renderMarkets(){
  if(qObs)qObs.disconnect();qVis.clear();
  const all=pairs.map(x=>({s:x.symbol,n:`${x.currency_base} / ${x.currency_quote}`,group:x.currency_group||"Forex"}));
  const MAJ=["EUR/USD","GBP/USD","USD/JPY","USD/CHF","USD/CAD","AUD/USD","NZD/USD","EUR/GBP","EUR/JPY","GBP/JPY"],majors=MAJ.map(k=>all.find(x=>x.s===k)).filter(Boolean);
  const source=[...special,...majors,...all.filter(x=>!MAJ.includes(x.s))];
  const q=searchTerm.trim().toLowerCase();
  const filtered=source.filter(m=>{const groupOk=activeFilter==="All"||(activeFilter==="Forex"?m.group!=="Metals":m.group===activeFilter);return groupOk&&(!q||m.s.toLowerCase().includes(q)||m.n.toLowerCase().includes(q));});
  list.innerHTML=filtered.map(m=>`<button class="market" data-symbol="${escapeHtml(m.s)}" data-name="${escapeHtml(m.n)}"><div class="mk-row"><i class="mk-badge">${escapeHtml(m.s.slice(0,3))}</i><div><b>${escapeHtml(m.s)}</b><small>${escapeHtml(m.n)}</small></div></div><div class="quote" data-q="${escapeHtml(m.s)}"><b class="qp">—</b><small class="qc">Loading…</small><small class="qhl"></small></div></button>`).join("");
  if(!filtered.length){list.innerHTML='<div class="empty">No matching pairs.</div>';return;}
  document.querySelectorAll(".market").forEach(b=>{b.onclick=()=>openMarket(b.dataset.symbol,b.dataset.name);paintQuote(b.dataset.symbol);qObserve(b)});
}
async function openMarket(symbol,name){if(!protectedFeature())return;selected=symbol;selectedName=name;document.getElementById("chartSymbol").textContent=symbol;document.getElementById("chartName").textContent=name;document.getElementById("chartPrice").textContent="Loading…";show("chartScreen");await Promise.all([loadSelectedQuote(),loadChart()]);}
async function loadSelectedQuote(){try{const j=await api(`/api/market?symbol=${encodeURIComponent(selected)}`);const q=Object.values(normQuotes(j))[0];const pv=q?(q.close??q.price):null;if(pv!=null){storeQuotes(normQuotes(j));currentQuote=Number(pv);const ps=fmtPx(selected,pv);document.getElementById("chartPrice").textContent=ps;document.getElementById("ticketPrice").textContent=ps;updateTicketSummary();await maybeRunAlgo();}}catch(e){document.getElementById("chartPrice").textContent="—";console.warn(e.message)}}
async function refreshQuotes(){try{await refreshVisibleQuotes(true);if(selected)await loadSelectedQuote();const st=document.getElementById("dataStatus");st.textContent=`${pairs.length} FOREX PAIRS`;st.className="status ok";}catch(e){}}
async function loadPairs(){try{const j=await api("/api/pairs");pairs=(j.data||[]).map(x=>({symbol:x.symbol,currency_base:x.currency_base,currency_quote:x.currency_quote,currency_group:x.currency_group}));document.getElementById("pairCount").textContent=`${pairs.length} forex pairs available`;lab?.refreshSymbols(pairs);renderMarkets();document.getElementById("dataStatus").textContent=`${pairs.length} FOREX PAIRS`;document.getElementById("dataStatus").className="status ok";}catch(e){document.getElementById("dataStatus").textContent="PAIR CATALOG ERROR";document.getElementById("dataStatus").className="status err";list.innerHTML='<div class="empty">Unable to load the Twelve Data forex catalog.</div>';console.warn(e.message)}}

function ema(values,p){if(values.length<p)return null;let k=2/(p+1),v=values.slice(0,p).reduce((a,b)=>a+b,0)/p;for(let i=p;i<values.length;i++)v=values[i]*k+v*(1-k);return v;}
function sma(values,p){if(values.length<p)return null;const a=values.slice(-p);return a.reduce((x,y)=>x+y,0)/p;}
function bollinger(values,p=20,m=2){if(values.length<p)return null;const mid=sma(values,p),a=values.slice(-p),variance=a.reduce((s,v)=>s+(v-mid)**2,0)/p,sd=Math.sqrt(variance);return {mid,upper:mid+m*sd,lower:mid-m*sd};}
function rsi(values,p=14){if(values.length<p+1)return null;let gains=0,losses=0;for(let i=values.length-p;i<values.length;i++){const d=values[i]-values[i-1];if(d>=0)gains+=d;else losses-=d;}if(losses===0)return 100;const rs=(gains/p)/(losses/p);return 100-(100/(1+rs));}
function macd(values){if(values.length<35)return null;const line=ema(values,12)-ema(values,26), prev=[];for(let i=26;i<=values.length;i++){const fast=ema(values.slice(0,i),12),slow=ema(values.slice(0,i),26);if(fast!=null&&slow!=null)prev.push(fast-slow);}const signal=ema(prev,9);return {line,signal,hist:line-(signal||0)};}
function stochastic(data,p=14){if(data.length<p)return null;const a=data.slice(-p),hi=Math.max(...a.map(x=>x.high)),lo=Math.min(...a.map(x=>x.low)),c=a.at(-1).close;return hi===lo?50:((c-lo)/(hi-lo))*100;}
function atr(data,p=14){if(data.length<p+1)return null;const trs=[];for(let i=1;i<data.length;i++){const x=data[i],prev=data[i-1].close;trs.push(Math.max(x.high-x.low,Math.abs(x.high-prev),Math.abs(x.low-prev)));}return sma(trs,p);}

function resetSeries(){if(!chart)return;try{if(mainSeries)chart.removeSeries(mainSeries);}catch{};if(chartType==="candles")mainSeries=chart.addCandlestickSeries({upColor:"#15df91",downColor:"#ff5364",borderVisible:false,wickUpColor:"#15df91",wickDownColor:"#ff5364"});else if(chartType==="bars")mainSeries=chart.addBarSeries({upColor:"#15df91",downColor:"#ff5364",thinBars:false});else mainSeries=chart.addLineSeries({color:"#f5b91b",lineWidth:2});return mainSeries;}
async function rebuildIndicatorSeries(){
  if(!chart||!candleData.length)return;
  Object.values(indicatorState).flat().forEach(s=>{try{chart.removeSeries(s)}catch{}});
  Object.keys(indicatorState).forEach(k=>delete indicatorState[k]);
  const readouts=[];
  const selectedIndicators=[...activeIndicators];
  if(!selectedIndicators.length){document.getElementById("indicatorReadouts").innerHTML="";return;}
  const colors=["#55a8ff","#c58cff","#f5b91b","#15df91","#ff7b72","#62d8ff","#f48fb1","#a8e063","#ffb74d","#b39ddb"];
  for(let index=0;index<selectedIndicators.length;index++){
    const key=selectedIndicators[index];
    try{
      const cacheKey=`${selected}|${timeframe}|${key}`;
      let data=indicatorCache.get(cacheKey);
      if(!data){
        data=await api(`/api/indicator?indicator=${encodeURIComponent(key)}&symbol=${encodeURIComponent(selected)}&interval=${encodeURIComponent(timeframe)}&outputsize=300`);
        indicatorCache.set(cacheKey,data);
      }
      const values=(data.values||[]).slice().reverse();
      if(!values.length)continue;
      const excluded=new Set(["datetime","open","high","low","close","volume"]);
      const numericKeys=Object.keys(values[0]).filter(k=>!excluded.has(k)&&values.some(v=>Number.isFinite(Number(v[k]))));
      if(INDICATOR_OVERLAYS.has(key)){
        const seriesList=[];
        numericKeys.forEach((field,j)=>{
          const points=values.map(v=>({time:Math.floor(new Date(v.datetime).getTime()/1000),value:Number(v[field])})).filter(x=>Number.isFinite(x.value));
          if(!points.length)return;
          const series=chart.addLineSeries({color:colors[(index+j)%colors.length],lineWidth:1});
          series.setData(points);seriesList.push(series);
        });
        indicatorState[key]=seriesList;
      }else{
        const latest=values.at(-1);
        const label=INDICATOR_LABELS[key]||key.toUpperCase();
        const parts=numericKeys.slice(0,4).map(field=>`${field.replaceAll("_"," ")}: ${Number(latest[field]).toFixed(4)}`);
        readouts.push(`<div class="indicator-readout"><small>${escapeHtml(label)}</small><b>${escapeHtml(parts.join(" · ")||"No numeric output")}</b></div>`);
      }
    }catch(e){
      readouts.push(`<div class="indicator-readout"><small>${escapeHtml(INDICATOR_LABELS[key]||key)}</small><b>Unavailable</b><em>${escapeHtml(e.message||"Indicator request failed")}</em></div>`);
    }
  }
  document.getElementById("indicatorReadouts").innerHTML=readouts.join("");
}

async function loadChart(){const el=document.getElementById("chart");if(!el)return;document.getElementById("chartLoading").classList.remove("hidden");if(chart)chart.remove();chart=LightweightCharts.createChart(el,{layout:{background:{color:"#071321"},textColor:"#8195aa",attributionLogo:false},grid:{vertLines:{color:"#10243b"},horzLines:{color:"#10243b"}},rightPriceScale:{borderColor:"#17304d"},timeScale:{borderColor:"#17304d",timeVisible:true,secondsVisible:false},crosshair:{mode:1}});resetSeries();try{const j=await api(`/api/history?symbol=${encodeURIComponent(selected)}&interval=${timeframe}&outputsize=300`);candleData=(j.values||[]).reverse().map(x=>({time:Math.floor(new Date(x.datetime).getTime()/1000),open:+x.open,high:+x.high,low:+x.low,close:+x.close})).filter(x=>[x.open,x.high,x.low,x.close].every(Number.isFinite));mainSeries.setData(chartType==="line"?candleData.map(x=>({time:x.time,value:x.close})):candleData);chart.timeScale().fitContent();document.getElementById("chartStatus").textContent="Historical market data connected.";if(candleData.length&&!currentQuote){currentQuote=candleData.at(-1).close;document.getElementById("chartPrice").textContent=currentQuote;document.getElementById("ticketPrice").textContent=currentQuote;}await rebuildIndicatorSeries();updateTicketSummary();}catch(e){document.getElementById("chartStatus").textContent="Unable to load candles: "+e.message;}finally{document.getElementById("chartLoading").classList.add("hidden");}}

function setAuthMode(mode){authMode=mode;const signup=mode==="signup";document.getElementById("signInTab").classList.toggle("active",!signup);document.getElementById("signUpTab").classList.toggle("active",signup);document.getElementById("authTitle").textContent=signup?"Create your TickMax account":"Log in to TickMax";document.getElementById("authSubtitle").textContent=signup?"Create your login and first paper account.":"Use your TickMax login to unlock the terminal.";document.getElementById("authSubmit").textContent=signup?"Create Account":"Log In";document.getElementById("authSwitchText").textContent=signup?"Already have an account?":"New to TickMax?";document.getElementById("authSwitch").textContent=signup?"Log in":"Create account";document.getElementById("signupFields").classList.toggle("hidden",!signup);document.getElementById("authError").textContent="";}
function openAuth(mode="signin"){setAuthMode(mode);document.getElementById("authModal").classList.remove("hidden");}
function closeAuth(){document.getElementById("authModal").classList.add("hidden");}
async function handleAuthSubmit(e){e.preventDefault();const email=document.getElementById("authEmail").value.trim(),password=document.getElementById("authPassword").value,error=document.getElementById("authError"),button=document.getElementById("authSubmit");error.textContent="";button.disabled=true;button.textContent=authMode==="signup"?"Creating…":"Logging in…";try{if(authMode==="signup"){const amount=validateDeposit(document.getElementById("initialBalance").value),name=document.getElementById("accountName").value.trim()||"Demo Account";const cred=await createUserWithEmailAndPassword(auth,email,password);await createUserProfile(cred.user,{name,initialBalance:amount});}else await signInWithEmailAndPassword(auth,email,password);closeAuth();document.getElementById("loginPrompt").classList.add("hidden");}catch(err){error.textContent=niceAuthError(err);}finally{button.disabled=false;button.textContent=authMode==="signup"?"Create Account":"Log In";}}
function niceAuthError(e){const code=e?.code||"";if(code.includes("email-already-in-use"))return"An account already exists with this email.";if(code.includes("invalid-credential")||code.includes("wrong-password"))return"Email or password is incorrect.";if(code.includes("weak-password"))return"Use a password with at least 6 characters.";if(code.includes("invalid-email"))return"Enter a valid email address.";return e?.message||"Authentication failed.";}

function updateTicketSummary(){const qty=Number(document.getElementById("orderQty")?.value||0);document.getElementById("ticketNotional").textContent=money(qty*currentQuote);document.getElementById("ticketPrice").textContent=currentQuote?Number(currentQuote).toFixed(5):"—";}
async function placeOrder(side){document.getElementById("orderSide").value=side;document.getElementById("orderCard").scrollIntoView({behavior:"smooth",block:"center"});document.getElementById("orderQty").focus();}
async function refreshAccounts(){if(!currentUser)return;accounts=await getAccounts(currentUser.uid);if(!accounts.length){activeAccountId=await createPaperAccount(currentUser.uid,{name:"Demo Account",initialBalance:1000});accounts=await getAccounts(currentUser.uid);}if(!activeAccountId||!accounts.some(a=>a.id===activeAccountId))activeAccountId=accounts[0].id;const sel=document.getElementById("accountSelect");sel.innerHTML=accounts.map(a=>`<option value="${a.id}">${escapeHtml(a.name)} · ${money(a.balance)}</option>`).join("");sel.value=activeAccountId;await refreshAccount();}
async function refreshAccount(){if(!currentUser||!activeAccountId)return;try{const fresh=(await getAccounts(currentUser.uid)).find(a=>a.id===activeAccountId);if(!fresh)return;accounts=accounts.map(a=>a.id===activeAccountId?fresh:a);document.getElementById("accountBalance").textContent=money(fresh.balance);document.getElementById("accountEquity").textContent=money(fresh.equity);document.getElementById("activeAccountName").textContent=fresh.name;document.getElementById("accountEmail").textContent=currentUser.email||"";updateAlgoUI(!!fresh.algoEnabled);const trades=await getPaperTrades(currentUser.uid,activeAccountId);const open=trades.filter(t=>t.status==="OPEN");document.getElementById("openPositions").textContent=open.length;const pnl=open.reduce((s,t)=>s+(t.side==="SELL"?(Number(t.price)-currentQuote):(currentQuote-Number(t.price)))*Number(t.quantity),0);document.getElementById("accountPnl").textContent=money(pnl);document.getElementById("accountPnl").className=pnl>=0?"up":"down";document.getElementById("tradeHistory").innerHTML=trades.length?trades.map(t=>`<div class="trade-row"><div><b>${escapeHtml(t.side)} ${escapeHtml(t.symbol)}</b><small>${Number(t.quantity).toFixed(4)} @ ${Number(t.price).toFixed(5)} · ${escapeHtml(t.source||"MANUAL")}</small></div>${t.status==="OPEN"?`<button class="close-trade" data-id="${t.id}">Close</button>`:`<span class="pnl ${Number(t.pnl)>=0?"up":"down"}">${Number(t.pnl)>=0?"+":""}${money(t.pnl)}</span>`}</div>`).join(""):"<p class=\"hint\">No paper trades yet.</p>";document.querySelectorAll(".close-trade").forEach(btn=>btn.onclick=()=>closeTrade(btn.dataset.id));}catch(e){console.warn(e.message)}}
async function closeTrade(id){if(!currentQuote)return;try{await closePaperTrade(currentUser.uid,activeAccountId,id,currentQuote);await refreshAccount();}catch(e){openGeneric("Could not close trade",e.message||"Please try again.");}}
function updateAlgoUI(enabled){document.getElementById("algoToggle").classList.toggle("on",enabled);document.getElementById("algoToggle").setAttribute("aria-pressed",String(enabled));document.getElementById("algoState").textContent=enabled?"ON":"OFF";document.getElementById("algoState").className=enabled?"pill green":"pill";}
async function maybeRunAlgo(){if(lab)await lab.runEAs();}
function addAlgoLog(text){const box=document.getElementById("algoLog"),empty=box.querySelector(".hint");if(empty)empty.remove();const row=document.createElement("div");row.className="activity-item";row.innerHTML=`<span class="activity-dot"></span><div><b>${escapeHtml(text)}</b><small>${new Date().toLocaleTimeString()}</small></div>`;box.prepend(row);}


// Navigation and controls
document.querySelectorAll(".bottom-nav button").forEach(b=>b.onclick=()=>show(b.dataset.screen));
document.getElementById("brandHome").onclick=()=>show("markets");
document.getElementById("loginChip").onclick=()=>{if(currentUser)show("account");else openAuth("signin")};
let onboardingStep=0;
function finishOnboarding(){localStorage.setItem("tickmax-onboarding-1.0.0","1");document.getElementById("onboarding").classList.add("hidden");}
function renderOnboardingStep(){
  document.querySelectorAll(".onboard-slide").forEach((slide,i)=>slide.classList.toggle("active",i===onboardingStep));
  document.querySelectorAll("#onboardDots button").forEach((dot,i)=>{dot.classList.toggle("active",i===onboardingStep);dot.setAttribute("aria-current",i===onboardingStep?"step":"false")});
  const next=document.getElementById("startBtn");
  next.textContent=onboardingStep===2?"Get Started":"Next";
}
document.getElementById("startBtn").onclick=()=>{if(onboardingStep<2){onboardingStep++;renderOnboardingStep()}else finishOnboarding()};
document.getElementById("skipOnboarding").onclick=finishOnboarding;
document.querySelectorAll("#onboardDots button").forEach(dot=>dot.onclick=()=>{onboardingStep=Number(dot.dataset.dot)||0;renderOnboardingStep()});
renderOnboardingStep();
document.getElementById("refreshBtn").onclick=refreshQuotes;
document.getElementById("pairSearch").addEventListener("input",e=>{searchTerm=e.target.value;renderMarkets()});
document.querySelectorAll(".tab").forEach(b=>b.onclick=()=>{document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));b.classList.add("active");activeFilter=b.dataset.filter;renderMarkets()});
document.getElementById("backBtn").onclick=()=>show("markets");
document.querySelectorAll("[data-tf]").forEach(b=>b.onclick=()=>{document.querySelectorAll("[data-tf]").forEach(x=>x.classList.remove("active"));b.classList.add("active");timeframe=b.dataset.tf;localStorage.setItem("tickmax-tf",timeframe);loadChart()});
document.querySelectorAll("[data-chart-type]").forEach(b=>b.onclick=()=>{document.querySelectorAll("[data-chart-type]").forEach(x=>x.classList.remove("active"));b.classList.add("active");chartType=b.dataset.chartType;loadChart()});
document.getElementById("indicatorBtn").onclick=()=>document.getElementById("indicatorPanel").classList.toggle("hidden");
document.getElementById("indicatorClose").onclick=()=>document.getElementById("indicatorPanel").classList.add("hidden");
const indicatorSearch=document.getElementById("indicatorSearch");indicatorSearch?.addEventListener("input",e=>{const q=e.target.value.toLowerCase().trim();document.querySelectorAll(".indicator-chip").forEach(b=>b.classList.toggle("hidden",q&&!b.textContent.toLowerCase().includes(q)));document.querySelectorAll(".indicator-category").forEach(c=>c.classList.toggle("hidden",q&&!Array.from(c.querySelectorAll(".indicator-chip")).some(b=>!b.classList.contains("hidden"))));});
document.querySelectorAll("[data-indicator]").forEach(b=>b.onclick=async()=>{const k=b.dataset.indicator;if(activeIndicators.has(k)){activeIndicators.delete(k);b.classList.remove("active")}else{activeIndicators.add(k);b.classList.add("active")}await rebuildIndicatorSeries()});
document.getElementById("drawBtn").onclick=()=>openGeneric("Drawing tools","Chart drawing controls are reserved for the next interaction layer. The chart already supports crosshair, zoom and scroll.");
document.getElementById("settingsBtn").onclick=()=>openGeneric("Chart settings","TickMax keeps the chart in the TickMax dark theme with automatic price scaling and time-aware candles.");
document.getElementById("orderQty").oninput=updateTicketSummary;
document.getElementById("buyQuick").onclick=()=>placeOrder("BUY");document.getElementById("sellQuick").onclick=()=>placeOrder("SELL");document.getElementById("openOrderTicket").onclick=()=>document.getElementById("orderCard").scrollIntoView({behavior:"smooth",block:"center"});
document.getElementById("placeOrder").onclick=async()=>{if(!protectedFeature()||!activeAccountId)return;if(!currentQuote)return;const qty=Number(document.getElementById("orderQty").value),side=document.getElementById("orderSide").value,status=document.getElementById("orderStatus");const sl=Number(document.getElementById("orderSL").value)||null,tp=Number(document.getElementById("orderTP").value)||null;status.textContent="Saving paper order…";try{await placePaperTrade(currentUser.uid,activeAccountId,{symbol:selected,name:selectedName,side,quantity:qty,price:currentQuote,source:"MANUAL",stopLoss:sl,takeProfit:tp});status.textContent=`Paper ${side} order recorded at ${Number(currentQuote).toFixed(5)}.`;await refreshAccount();}catch(e){status.textContent=e.message||"Could not save paper order."}};
document.getElementById("accountSelect").onchange=async e=>{activeAccountId=e.target.value;await refreshAccount()};
document.getElementById("newAccountBtn").onclick=()=>{document.getElementById("accountModal").classList.remove("hidden");document.getElementById("accountError").textContent=""};
document.getElementById("accountDepositBtn").onclick=()=>document.getElementById("newAccountBtn").click();
document.getElementById("accountModalClose").onclick=()=>document.getElementById("accountModal").classList.add("hidden");
document.getElementById("createAccountBtn").onclick=async()=>{const err=document.getElementById("accountError");try{const id=await createPaperAccount(currentUser.uid,{name:document.getElementById("newAccountName").value,initialBalance:validateDeposit(document.getElementById("newAccountBalance").value)});activeAccountId=id;document.getElementById("accountModal").classList.add("hidden");await refreshAccounts();}catch(e){err.textContent=e.message}};
document.getElementById("algoToggle").onclick=async()=>{if(!protectedFeature()||!activeAccountId)return;const account=accounts.find(a=>a.id===activeAccountId),next=!account?.algoEnabled;try{await setAlgoEnabled(currentUser.uid,activeAccountId,next);await refreshAccounts();addAlgoLog(next?"Algo Trading turned ON":"Algo Trading turned OFF");}catch(e){addAlgoLog(e.message)}};
document.getElementById("logoutBtn").onclick=()=>signOut(auth);
document.getElementById("defaultTf").onchange=e=>{localStorage.setItem("tickmax-tf",e.target.value);timeframe=e.target.value;document.querySelectorAll("[data-tf]").forEach(b=>b.classList.toggle("active",b.dataset.tf===timeframe));if(currentUser)loadChart()};
document.getElementById("accountResetHint").onclick=async()=>{if(deferredInstallPrompt){deferredInstallPrompt.prompt();try{await deferredInstallPrompt.userChoice}catch{}deferredInstallPrompt=null;document.body.classList.remove("install-available");}else openGeneric("Paper accounts","TickMax uses simulated balances only. Real deposits and withdrawals are not connected. On Android, you can also use your browser menu and choose Add to Home screen.");};

document.getElementById("authForm").addEventListener("submit",handleAuthSubmit);document.getElementById("authSwitch").onclick=()=>setAuthMode(authMode==="signup"?"signin":"signup");document.getElementById("signInTab").onclick=()=>setAuthMode("signin");document.getElementById("signUpTab").onclick=()=>setAuthMode("signup");document.getElementById("authClose").onclick=closeAuth;document.getElementById("promptLogin").onclick=()=>{document.getElementById("loginPrompt").classList.add("hidden");openAuth("signin")};document.getElementById("promptCancel").onclick=()=>document.getElementById("loginPrompt").classList.add("hidden");document.getElementById("forgotPassword").onclick=async()=>{const email=document.getElementById("authEmail").value.trim(),error=document.getElementById("authError");if(!email){error.textContent="Enter your email first.";return;}try{await sendPasswordResetEmail(auth,email);error.className="auth-error success-text";error.textContent="Password reset email sent.";}catch(e){error.className="auth-error";error.textContent=niceAuthError(e)}};
document.getElementById("genericClose").onclick=()=>document.getElementById("genericModal").classList.add("hidden");document.getElementById("genericAction").onclick=()=>document.getElementById("genericModal").classList.add("hidden");
const lab=initLab({api,money,show,openGeneric,log:addAlgoLog,state:()=>({currentUser,activeAccountId,accounts}),getTrades:getPaperTrades,placeTrade:placePaperTrade,closeTrade:closePaperTrade,modifyTrade:updatePaperTradeStops,refreshAccounts});
setupDepositPicker("depositPickerBtn","depositPickerValue","initialBalance","depositOptions");setupDepositPicker("newAccountDepositBtn","newAccountDepositValue","newAccountBalance","newAccountDepositOptions");

function initOnboarding(){const seen=localStorage.getItem("tickmax-onboarding-1.0.0");setTimeout(()=>{document.getElementById("splash").classList.add("hidden");if(!seen)document.getElementById("onboarding").classList.remove("hidden")},700);}
onAuthStateChanged(auth,async user=>{currentUser=user;document.getElementById("loginChip").textContent=user?"Account":"Log In";if(user){document.getElementById("loginPrompt").classList.add("hidden");try{await createUserProfile(user);await refreshAccounts()}catch(e){console.warn(e.message)}loadPairs().then(refreshQuotes);loadChart()}else{accounts=[];activeAccountId=null;updateAlgoUI(false);loadPairs()}});
setInterval(()=>{if(currentUser)refreshQuotes()},900000);
setInterval(()=>{if(currentUser)maybeRunAlgo()},60000);
initOnboarding();
