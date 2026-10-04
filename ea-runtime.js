// MT5-style Expert Advisor runtime. An EA is a JS file with OnInit/OnTick that calls MT5-like functions.
// The SAME compiled EA runs in the Backtest and on the live paper account, so it behaves as coded in both.
import {ema,sma,smma,rsi,atr,metrics} from "./strategies.js";
export const CONTRACT=s=>/XAU/.test(s)?100:/XAG/.test(s)?5000:100000;
export function usdConv(symbol){const [base,quote]=String(symbol).split("/"),baseUSD=base==="USD",quoteUSD=quote==="USD"||!quote;
 return {baseUSD,quoteUSD,cross:!baseUSD&&!quoteUSD,toUsd:(q,price)=>quoteUSD?q:baseUSD?q/price:q,margin:(units,entry,lev)=>baseUSD?units/lev:units*entry/lev}}
const NAMES=["Open","High","Low","Close","Time","Bars","iMA","iRSI","iATR","iMACD","iBands","iStochastic","HighestHigh","LowestLow","Buy","Sell","Positions","PositionsTotal","PositionClose","CloseAll","PositionModify","AccountBalance","AccountEquity","Ask","Bid","Point","Pip","Symbol","Print","NormalizeDouble"];
export const EA_EXAMPLE=`// @name EMA Cross (example)
// @input fast = 9
// @input slow = 21
// @input lots = 0.1
// @input slAtr = 1.5
// @input tpAtr = 3

function OnTick(){
  // Shift 1 = last CLOSED bar. Shift 0 = current price (bar open).
  const f1=iMA(Inputs.fast,"EMA",1), s1=iMA(Inputs.slow,"EMA",1);
  const f2=iMA(Inputs.fast,"EMA",2), s2=iMA(Inputs.slow,"EMA",2);
  const a=iATR(14,1);
  const crossUp=f2<=s2 && f1>s1, crossDn=f2>=s2 && f1<s1;
  if(crossUp||crossDn){
    CloseAll();
    if(crossUp) Buy(Inputs.lots, Ask()-a*Inputs.slAtr, Ask()+a*Inputs.tpAtr);
    else        Sell(Inputs.lots, Bid()+a*Inputs.slAtr, Bid()-a*Inputs.tpAtr);
  }
}`;
export function looksLikeMQL(code,filename=""){return /\.(mq5|mq4|ex5|ex4)$/i.test(filename)||/#property|#include|\bvoid\s+OnTick\s*\(|\bint\s+OnInit\s*\(|\bCTrade\b/.test(code)}
export function parseMeta(code){
 const meta={name:(code.match(/\/\/\s*@name\s+(.+)/)||[])[1]?.trim()||"Custom EA",inputs:{}};
 for(const m of code.matchAll(/^\s*\/\/\s*@input\s+(\w+)\s*=\s*([^\s/]+)/gm))meta.inputs[m[1]]=m[2]==="true"?true:m[2]==="false"?false:(m[2]!==""&&!isNaN(m[2])?Number(m[2]):m[2]);
 return meta;
}
export function compileEA(code){
 const meta=parseMeta(code);
 const factory=new Function("m","Inputs",`"use strict";const {${NAMES.join(",")}}=m;\n${code}\n;return {OnInit:typeof OnInit==="function"?OnInit:null,OnTick:typeof OnTick==="function"?OnTick:null,OnDeinit:typeof OnDeinit==="function"?OnDeinit:null};`);
 const probe=factory(new Proxy({},{get:()=>()=>NaN}),{...meta.inputs});
 if(!probe.OnTick)throw Error("The file must define function OnTick().");
 return {meta,factory};
}
const wma=(a,p)=>{const o=new Array(a.length).fill(null),d=p*(p+1)/2;for(let i=p-1;i<a.length;i++){let s=0;for(let k=0;k<p;k++)s+=a[i-k]*(p-k);o[i]=s/d}return o};
export function makeApi(core,broker){
 const c=core.c,cl=()=>core.cache.cl||(core.cache.cl=c.map(x=>x.close));
 const memo=(k,f)=>core.cache[k]||(core.cache[k]=f());
 const val=(arr,s=1)=>{const v=arr[core.i-Math.max(1,s)];return v==null?NaN:v};
 const bar=(s,f)=>s<=0?c[core.i].open:(c[core.i-s]?c[core.i-s][f]:NaN);
 return {
  Open:s=>bar(s,"open"),High:s=>bar(s,"high"),Low:s=>bar(s,"low"),Close:s=>bar(s,"close"),
  Time:s=>c[core.i-Math.max(0,s)]?.time,Bars:()=>core.i,
  iMA:(p,method="SMA",s=1)=>{method=String(method).toUpperCase();return val(memo(`ma${method}${p}`,()=>method==="EMA"?ema(cl(),p):method==="SMMA"?smma(cl(),p):(method==="WMA"||method==="LWMA")?wma(cl(),p):sma(cl(),p)),s)},
  iRSI:(p,s=1)=>val(memo(`rsi${p}`,()=>rsi(cl(),p)),s),
  iATR:(p,s=1)=>val(memo(`atr${p}`,()=>atr(c,p)),s),
  iMACD:(f,sl,sg,s=1)=>{const k=memo(`macd${f}.${sl}.${sg}`,()=>{const a=ema(cl(),f,true),b=ema(cl(),sl,true),m=a.map((v,i)=>v-b[i]);return {m:m.map((v,i)=>i>=sl-1?v:null),g:sma(m,sg).map((v,i)=>i>=sl-1+sg-1?v:null)}});const m=val(k.m,s),g=val(k.g,s);return {main:m,signal:g,hist:m-g}},
  iBands:(p,dev,s=1)=>{const k=memo(`bb${p}`,()=>{const m=sma(cl(),p),sd=m.map((mv,i)=>{if(mv==null)return null;let q=0;for(let j=i-p+1;j<=i;j++)q+=(c[j].close-mv)**2;return Math.sqrt(q/p)});return {m,sd}});const m=val(k.m,s),sd=val(k.sd,s);return {upper:m+dev*sd,middle:m,lower:m-dev*sd}},
  iStochastic:(kp,dp,slow,s=1)=>{const k=memo(`st${kp}.${dp}.${slow}`,()=>{const num=[],den=[];c.forEach((x,i)=>{if(i<kp-1){num.push(null);den.push(null);return}let hh=-Infinity,ll=Infinity;for(let j=i-kp+1;j<=i;j++){hh=Math.max(hh,c[j].high);ll=Math.min(ll,c[j].low)}num.push(x.close-ll);den.push(hh-ll)});
   const main=c.map((_,i)=>{if(i<kp-1+slow-1)return null;let a=0,b=0;for(let j=0;j<slow;j++){a+=num[i-j];b+=den[i-j]}return b?a/b*100:100});
   const sig=main.map((_,i)=>{if(i<kp-1+slow-1+dp-1)return null;let a=0;for(let j=0;j<dp;j++)a+=main[i-j];return a/dp});return {main,sig}});return {k:val(k.main,s),d:val(k.sig,s)}},
  HighestHigh:(p,s=1)=>{let h=-Infinity;for(let j=0;j<p;j++){const x=c[core.i-s-j];if(x)h=Math.max(h,x.high)}return h},
  LowestLow:(p,s=1)=>{let l=Infinity;for(let j=0;j<p;j++){const x=c[core.i-s-j];if(x)l=Math.min(l,x.low)}return l},
  Buy:(lots,sl=0,tp=0,comment="")=>broker.open(1,lots,sl,tp,comment),Sell:(lots,sl=0,tp=0,comment="")=>broker.open(-1,lots,sl,tp,comment),
  Positions:()=>broker.positions().map(p=>({id:p.id,type:p.dir>0?"BUY":"SELL",lots:p.lots,open:p.entry,sl:p.sl,tp:p.tp,comment:p.comment,time:p.time,profit:broker.floating(p)})),
  PositionsTotal:()=>broker.positions().length,PositionClose:id=>broker.close(id,"EA"),CloseAll:()=>broker.positions().slice().forEach(p=>broker.close(p.id,"EA")),PositionModify:(id,sl,tp)=>broker.modify(id,sl,tp),
  AccountBalance:()=>broker.balance(),AccountEquity:()=>broker.equity(),Ask:()=>broker.ask(),Bid:()=>broker.bid(),Point:()=>core.pip/10,Pip:()=>core.pip,Symbol:()=>core.symbol,
  Print:(...a)=>{core.log.push(`${new Date(c[core.i].time*1000).toISOString().slice(0,16).replace("T"," ")}  ${a.join(" ")}`);if(core.log.length>500)core.log.shift()},
  NormalizeDouble:(v,d)=>+Number(v).toFixed(d)
 };
}
export function backtestEA(ea,candles,cfg){
 const core={c:candles,i:0,symbol:cfg.symbol,pip:cfg.pip,cache:{},log:[]},pt=cfg.pip/10,fx=usdConv(cfg.symbol),contract=cfg.contract>0?cfg.contract:CONTRACT(cfg.symbol),LEV=cfg.leverage||100;
 const stamp=()=>new Date(candles[core.i].time*1000).toISOString().slice(0,16).replace("T"," ");
 let bal=cfg.balance,pos=[],trades=[],eq=[],nid=1,dead=false;
 if(fx.cross)core.log.push(`Note: ${cfg.symbol} is a cross pair. Profit is shown in the quote currency (no conversion to USD).`);
 if(cfg.commission>0)core.log.push(`Commission: ${cfg.commission} per lot (round turn), deducted from each trade's P/L.`);
 const spr=()=>{const b=candles[core.i];return (b.spreadPts!=null?b.spreadPts:(cfg.spreadPts||0))*pt};
 const px=()=>candles[core.i].open;
 const fl=(p,bid,s)=>fx.toUsd(((p.dir>0?bid:bid+s)-p.entry)*p.dir*p.units,bid);
 const equity=()=>bal+pos.reduce((s,p)=>s+fl(p,px(),spr()),0),used=()=>pos.reduce((s,p)=>s+fx.margin(p.units,p.entry,LEV),0);
 const closePos=(p,price,why)=>{const gross=fx.toUsd((price-p.entry)*p.dir*p.units,price),comm=(cfg.commission||0)*p.lots,g=gross-comm;bal+=g;trades.push({dir:p.dir,lots:p.lots,units:p.units,entry:p.entry,time:p.time,exit:price,exitTime:candles[core.i].time,pnl:g,gross,commission:comm,why,bars:core.i-p.i,balance:bal,comment:p.comment});pos=pos.filter(x=>x!==p)};
 const broker={positions:()=>pos,ask:()=>px()+spr(),bid:()=>px(),balance:()=>bal,equity,floating:p=>fl(p,px(),spr()),
  open(dir,lots,sl,tp,comment){lots=+lots;sl=+sl||0;tp=+tp||0;const entry=dir>0?px()+spr():px(),units=lots*contract;
   const bad=m=>{core.log.push(`${stamp()}  Order rejected: ${m}`);return 0};
   if(!(lots>0))return bad("invalid lots");
   if((sl&&(dir>0?sl>=entry:sl<=entry))||(tp&&(dir>0?tp<=entry:tp>=entry)))return bad("invalid stops");
   if(fx.margin(units,entry,LEV)>equity()-used())return bad("not enough margin");
   const p={id:nid++,dir,lots,units,entry,sl,tp,time:candles[core.i].time,i:core.i,comment};pos.push(p);return p.id},
  close(id,why){const p=pos.find(x=>x.id===id);if(p)closePos(p,p.dir>0?px():px()+spr(),why);return !!p},
  modify(id,sl,tp){const p=pos.find(x=>x.id===id);if(!p)return false;p.sl=+sl||0;p.tp=+tp||0;return true}};
 const inst=ea.factory(makeApi(core,broker),{...ea.meta.inputs,...cfg.inputs});
 try{core.i=1;inst.OnInit&&inst.OnInit();
  for(let i=1;i<candles.length&&!dead;i++){core.i=i;const b=candles[i],s=spr();
   for(const p of pos.slice()){if(p.i>=i)continue;if(p.dir>0){if(p.sl&&b.open<=p.sl)closePos(p,b.open,"SL");else if(p.tp&&b.open>=p.tp)closePos(p,b.open,"TP")}else{if(p.sl&&b.open+s>=p.sl)closePos(p,b.open+s,"SL");else if(p.tp&&b.open+s<=p.tp)closePos(p,b.open+s,"TP")}}
   inst.OnTick();
   for(const p of pos.slice()){if(p.dir>0){if(p.sl&&b.low<=p.sl)closePos(p,p.sl,"SL");else if(p.tp&&b.high>=p.tp)closePos(p,p.tp,"TP")}else{if(p.sl&&b.high+s>=p.sl)closePos(p,p.sl,"SL");else if(p.tp&&b.low+s<=p.tp)closePos(p,p.tp,"TP")}}
   const e=bal+pos.reduce((a,p)=>a+fl(p,b.close,s),0);eq.push({time:b.time,value:e});
   if(e<=0){pos.slice().forEach(p=>closePos(p,p.dir>0?b.close:b.close+s,"Stop-out"));core.log.push("Account blown: equity reached zero.");dead=true}}
  if(!dead){core.i=candles.length-1;const s=spr();pos.slice().forEach(p=>closePos(p,p.dir>0?candles.at(-1).close:candles.at(-1).close+s,"End"))}
  inst.OnDeinit&&inst.OnDeinit();
 }catch(e){core.log.push(`Runtime error at ${stamp()}: ${e.message}`);pos.slice().forEach(p=>closePos(p,candles[core.i].close,"Error"))}
 return {trades,equity:eq,metrics:metrics(trades,eq,cfg.balance),candles,log:core.log};
}
