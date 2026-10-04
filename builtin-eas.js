// Built-in Expert Advisors written in the same EA format as imported files (full source, own inputs).
const COMMON=[["lots",0.1],["slAtr",1.5],["tpAtr",3],["allowShort",true],["closeOnOpposite",true]];
const ENTER=`
// slAtr/tpAtr: stop and target as a multiple of ATR(14) (0 = off)
function Enter(sig){
  if(!sig) return;
  if(sig<0 && !Inputs.allowShort){ if(Inputs.closeOnOpposite) CloseAll(); return; }
  const open=Positions();
  if(open.length && ((open[0].type==="BUY")===(sig>0))) return;
  if(Inputs.closeOnOpposite) CloseAll();
  if(PositionsTotal()>0) return;
  const a=iATR(14,1), px=sig>0?Ask():Bid();
  const sl=Inputs.slAtr>0 ? px-sig*a*Inputs.slAtr : 0;
  const tp=Inputs.tpAtr>0 ? px+sig*a*Inputs.tpAtr : 0;
  if(sig>0) Buy(Inputs.lots,sl,tp); else Sell(Inputs.lots,sl,tp);
}`;
const mk=(id,name,desc,own,sig)=>{const all=[...own,...COMMON],code=`// @name ${name}\n${all.map(([k,v])=>`// @input ${k} = ${v}`).join("\n")}\n${ENTER}\n\nfunction OnTick(){\n${sig}\n}\n`;return {id,name,desc,code,inputs:Object.fromEntries(all)}};
export const BUILTIN=[
 mk("b-ema","EMA Crossover","Buy when the fast EMA crosses above the slow EMA; sell on the reverse.",[["fast",9],["slow",21]],
 `  const f1=iMA(Inputs.fast,"EMA",1),s1=iMA(Inputs.slow,"EMA",1),f2=iMA(Inputs.fast,"EMA",2),s2=iMA(Inputs.slow,"EMA",2);
  Enter(f2<=s2&&f1>s1?1:f2>=s2&&f1<s1?-1:0);`),
 mk("b-sma","SMA Crossover","Classic trend following with two simple moving averages.",[["fast",20],["slow",50]],
 `  const f1=iMA(Inputs.fast,"SMA",1),s1=iMA(Inputs.slow,"SMA",1),f2=iMA(Inputs.fast,"SMA",2),s2=iMA(Inputs.slow,"SMA",2);
  Enter(f2<=s2&&f1>s1?1:f2>=s2&&f1<s1?-1:0);`),
 mk("b-rsi","RSI Reversal","Buy when RSI climbs back above oversold; sell when it falls back below overbought.",[["period",14],["oversold",30],["overbought",70]],
 `  const r1=iRSI(Inputs.period,1),r2=iRSI(Inputs.period,2);
  Enter(r2<Inputs.oversold&&r1>=Inputs.oversold?1:r2>Inputs.overbought&&r1<=Inputs.overbought?-1:0);`),
 mk("b-macd","MACD Signal Cross","Trade the MACD main line crossing its signal line.",[["fast",12],["slow",26],["signal",9]],
 `  const a=iMACD(Inputs.fast,Inputs.slow,Inputs.signal,1),b=iMACD(Inputs.fast,Inputs.slow,Inputs.signal,2);
  Enter(b.main<=b.signal&&a.main>a.signal?1:b.main>=b.signal&&a.main<a.signal?-1:0);`),
 mk("b-bb","Bollinger Reversion","Buy when price closes back inside the lower band; sell back inside the upper band.",[["period",20],["deviation",2]],
 `  const a=iBands(Inputs.period,Inputs.deviation,1),b=iBands(Inputs.period,Inputs.deviation,2),c1=Close(1),c2=Close(2);
  Enter(c2<b.lower&&c1>=a.lower?1:c2>b.upper&&c1<=a.upper?-1:0);`),
 mk("b-don","Donchian Breakout","Buy a close above the N-bar high; sell a close below the N-bar low.",[["period",20]],
 `  const c1=Close(1);
  Enter(c1>HighestHigh(Inputs.period,2)?1:c1<LowestLow(Inputs.period,2)?-1:0);`)
];
