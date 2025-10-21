/* ========== BTC Live + DCA (v4, single-select) ========== */

const qs = s => document.querySelector(s);
const qsa = s => Array.from(document.querySelectorAll(s));

function showToast(msg){
  const el = document.getElementById('toast');
  el.textContent = msg; el.style.display='block';
  setTimeout(()=> el.style.display='none', 1800);
}
const fmtUSD = new Intl.NumberFormat('en-US', { style:'currency', currency:'USD', maximumFractionDigits:2 });
const fmtIDR = new Intl.NumberFormat('id-ID', { style:'currency', currency:'IDR', maximumFractionDigits:0 });
const fmtPct = new Intl.NumberFormat('id-ID', { style:'percent', maximumFractionDigits:2 });

// Thousand separator masking
function unformatNum(str){
  if (typeof str === 'number') return str;
  if (!str) return 0;
  const only = (str+'').replace(/[^0-9.]/g, '');
  const digits = only.replace(/\./g, '');
  const val = parseFloat(digits);
  return isFinite(val) ? val : 0;
}
function maskThousandsInput(el){
  const n = unformatNum(el.value);
  el.value = n ? new Intl.NumberFormat('id-ID', {maximumFractionDigits:0}).format(Math.round(n)) : '0';
}
['dcaAmount'].forEach(id => {
  const el = document.getElementById(id);
  el.addEventListener('input', ()=> maskThousandsInput(el));
  el.addEventListener('blur', ()=> maskThousandsInput(el));
});

function yearsAgo(n){
  const d = new Date();
  d.setFullYear(d.getFullYear() - n);
  return d.getTime();
}

// ========== Providers ==========
async function getCGSimple(currency='usd', key=null){
  const headers = key ? {'x-cg-demo-api-key': key} : {};
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=${currency}&include_24hr_change=true`;
  const r = await fetch(url, { headers });
  if(!r.ok) throw new Error('CG simple price error');
  const j = await r.json();
  const price = j?.bitcoin?.[currency];
  const chg = j?.bitcoin?.[`${currency}_24h_change`];
  return { price: Number(price), changePct: Number(chg) };
}

async function getCoinbaseSpotUSD(){
  const url = `https://api.coinbase.com/v2/prices/BTC-USD/spot`;
  const r = await fetch(url);
  if(!r.ok) throw new Error('Coinbase spot error');
  const j = await r.json();
  return Number(j?.data?.amount || 0);
}

async function getCGHistory(vs='usd', key=null){
  const headers = key ? {'x-cg-demo-api-key': key} : {};
  const url = `https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=${vs}&days=max`;
  const r = await fetch(url, { headers });
  if(!r.ok) throw new Error('CoinGecko market_chart error');
  const j = await r.json();
  return j.prices || [];
}

async function getCGHistoryDays(vs='usd', days=7, key=null){
  const headers = key ? {'x-cg-demo-api-key': key} : {};
  const url = `https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=${vs}&days=${days}`;
  const r = await fetch(url, { headers });
  if(!r.ok) throw new Error('CoinGecko spark error');
  const j = await r.json();
  return j.prices || [];
}

// ========== Charts ==========
let sparkChart, mainChart;
function ensureSpark(){
  if(sparkChart) return sparkChart;
  const ctx = document.getElementById('btcSpark');
  sparkChart = new Chart(ctx, {
    type:'line',
    data:{ labels:[], datasets:[{label:'BTC', data:[], tension:.25, pointRadius:0}] },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{ display:false }, tooltip:{ callbacks:{ label: (c)=> fmtUSD.format(c.parsed.y) } } },
      scales:{ x:{ display:false }, y:{ display:false } }
    }
  });
  return sparkChart;
}
function ensureMain(){
  if(mainChart) return mainChart;
  const ctx = document.getElementById('btcChart');
  mainChart = new Chart(ctx, {
    type:'line',
    data:{ labels:[], datasets:[
      { label:'Harga BTC', data:[], yAxisID:'y', tension:.2, pointRadius:0, borderWidth:2 },
      { label:'Nilai Portofolio', data:[], yAxisID:'y', tension:.2, pointRadius:0, borderWidth:2 }
    ]},
    options:{
      responsive:true, maintainAspectRatio:false, interaction:{mode:'index', intersect:false},
      plugins:{ legend:{ labels:{ color:'#cfe7d6' } }, tooltip:{ callbacks:{ label: (c)=> (getCurrency()==='USD'?fmtUSD:fmtIDR).format(c.parsed.y) } } },
      scales:{
        x:{ ticks:{ color:'#9bb6a5' }, grid:{ color:'rgba(255,255,255,.06)' } },
        y:{ ticks:{ color:'#9bb6a5', callback:(v)=> (getCurrency()==='USD'?fmtUSD:fmtIDR).format(v) }, grid:{ color:'rgba(255,255,255,.06)' } }
      }
    }
  });
  return mainChart;
}
function updateSpark(series){
  const ch = ensureSpark();
  ch.data.labels = series.map(p=> new Date(p[0]).toLocaleDateString('id-ID'));
  ch.data.datasets[0].data = series.map(p=> p[1]);
  ch.update();
}
function updateMainPriceSeries(series){
  const ch = ensureMain();
  ch.data.labels = series.map(p=> new Date(p[0]).toLocaleDateString('id-ID'));
  ch.data.datasets[0].data = series.map(p=> p[1]);
  ch.update();
}
function plotPortfolioSeries(series){
  const ch = ensureMain();
  // Make labels match price series length; assume we already updated price series
  ch.data.datasets[1].data = series.map(p=> p[1]);
  ch.update();
}

// ========== Single-select helpers ==========
function makeSingleSelect(containerSel, attr){
  const container = qs(containerSel);
  container.addEventListener('click', (e)=>{
    if(!e.target.classList.contains('pill')) return;
    container.querySelectorAll('.pill').forEach(b=> b.classList.remove('active'));
    e.target.classList.add('active');
    if(attr==='years') onDurationChange();
    if(attr==='freq') onFreqChange();
  });
}
function getSelectedYears(){
  const b = qs('#durasiSet .pill.active');
  return b ? parseInt(b.dataset.years,10) : 1;
}
function getSelectedFreq(){
  const b = qs('#freqSet .pill.active');
  return b ? b.dataset.freq : 'bulanan';
}
function getCurrency(){ return (qs('#dcaCurrency')?.value || 'USD'); }

// ========== DCA Core ==========
function pickSchedule(startMs, endMs, freq){
  const out = [];
  const start = new Date(startMs);
  const end = new Date(endMs);
  function push(d){ if(d.getTime()<=end.getTime()) out.push(d.getTime()); }

  if(freq==='sekali'){ push(new Date(start)); return out; }
  if(freq==='mingguan'){
    let d = new Date(start);
    while(d<=end){ push(new Date(d)); d = new Date(d.getTime() + 7*24*3600*1000); }
  }else if(freq==='bulanan'){
    let d = new Date(start);
    while(d<=end){ push(new Date(d)); d.setMonth(d.getMonth()+1); }
  }else if(freq==='semesteran'){
    let d = new Date(start);
    while(d<=end){ push(new Date(d)); d.setMonth(d.getMonth()+6); }
  }else if(freq==='tahunan'){
    let d = new Date(start);
    while(d<=end){ push(new Date(d)); d.setFullYear(d.getFullYear()+1); }
  }
  return out;
}
function nearestPrice(prices, targetMs){
  let lo=0, hi=prices.length-1;
  while(lo<hi){
    const mid = Math.floor((lo+hi)/2);
    if(prices[mid][0] < targetMs) lo = mid+1; else hi = mid;
  }
  const a = prices[Math.max(0, lo-1)];
  const b = prices[Math.min(prices.length-1, lo)];
  return (Math.abs(a[0]-targetMs) <= Math.abs(b[0]-targetMs)) ? a : b;
}
function buildPortfolioSeries(prices, scheduleMs, amountPerContribution, currentPrice){
  let totalBTC = 0;
  const series = [];
  let iSched = 0;
  for(const [ms, px] of prices){
    while(iSched < scheduleMs.length && scheduleMs[iSched] <= ms){
      const [_, pxBuy] = nearestPrice(prices, scheduleMs[iSched]);
      totalBTC += (amountPerContribution / pxBuy);
      iSched++;
    }
    series.push([ms, totalBTC * px]);
  }
  const finalValue = totalBTC * (currentPrice || (prices.length?prices[prices.length-1][1]:0));
  const totalInvested = amountPerContribution * scheduleMs.length;
  const roi = totalInvested>0 ? (finalValue/totalInvested - 1) : 0;
  return { series, finalValue, totalInvested, totalBTC, roi, times: scheduleMs.length };
}
function sliceByYears(prices, years){
  const startMs = yearsAgo(years);
  return prices.filter(p => p[0] >= startMs);
}

// ========== State ==========
const cacheHist = {}; // { 'USD': [...], 'IDR': [...] }
let currentSlice = []; // current duration slice

// ========== Live & History Init ==========
async function refreshLive(){
  const key = qs('#coingeckoKey').value.trim() || null;
  const currency = getCurrency().toLowerCase();
  try{
    const {price, changePct} = await getCGSimple(currency, key);
    const fmtMoney = currency==='usd' ? fmtUSD : fmtIDR;
    qs('#btcPrice').textContent = fmtMoney.format(price);
    const chg = Number(changePct||0);
    const chgEl = qs('#btcChange');
    chgEl.textContent = `24h: ${(chg>=0?'+':'') + chg.toFixed(2)}%`;
    chgEl.classList.remove('pos','neg');
    chgEl.classList.add(chg>=0? 'pos':'neg');
    qs('#btcPair').textContent = `BTC-${currency.toUpperCase()}`;
    qs('#btcUpdated').textContent = new Date().toLocaleString('id-ID', {hour12:false});
  }catch(e){
    try{
      const usd = await getCoinbaseSpotUSD();
      qs('#btcPrice').textContent = fmtUSD.format(usd);
      qs('#btcChange').textContent = 'Spot (fallback Coinbase)';
      qs('#btcPair').textContent = 'BTC-USD';
    }catch{
      qs('#btcPrice').textContent = 'Gagal memuat';
    }
  }
}
async function ensureHistory(currency){
  const key = qs('#coingeckoKey').value.trim() || null;
  if(cacheHist[currency]) return cacheHist[currency];
  const hist = await getCGHistory(currency.toLowerCase(), key);
  cacheHist[currency] = hist.sort((a,b)=>a[0]-b[0]);
  return cacheHist[currency];
}
async function initSpark(){
  const key = qs('#coingeckoKey').value.trim() || null;
  try{
    const spark = await getCGHistoryDays('usd', 7, key);
    updateSpark(spark);
  }catch(e){/* ignore */}
}

// ========== Duration Change ==========
async function onDurationChange(){
  const years = getSelectedYears();
  const currency = getCurrency();
  const hist = await ensureHistory(currency);
  currentSlice = sliceByYears(hist, years);
  updateMainPriceSeries(currentSlice);

  // Update duration change %
  const first = currentSlice[0]?.[1];
  const last = currentSlice[currentSlice.length-1]?.[1];
  const durPct = (first && last) ? ((last/first-1)*100) : 0;
  const el = qs('#btcChangeDur');
  el.textContent = `Δ ${years}y: ${(durPct>=0?'+':'') + durPct.toFixed(2)}%`;
  el.classList.remove('pos','neg'); el.classList.add(durPct>=0?'pos':'neg');

  // If we already computed scenario, re-run to align chart
  runSingleDCA(false);
}
function onFreqChange(){
  // Optionally auto-run
  runSingleDCA(false);
}

// ========== Compute Single Scenario ==========
async function runSingleDCA(showToastMsg=true){
  const currency = getCurrency();
  const hist = await ensureHistory(currency);
  const years = getSelectedYears();
  currentSlice = sliceByYears(hist, years);
  if(currentSlice.length===0){ showToast('History kosong'); return; }

  // Current price
  let current;
  try{
    const {price} = await getCGSimple(currency.toLowerCase(), qs('#coingeckoKey').value.trim() || null);
    current = price || currentSlice[currentSlice.length-1][1];
  }catch{
    current = currentSlice[currentSlice.length-1][1];
  }

  const fmtMoney = currency==='USD' ? fmtUSD : fmtIDR;
  const amount = unformatNum(qs('#dcaAmount').value);
  const freq = getSelectedFreq();

  // Schedule
  const startMs = currentSlice[0][0];
  const endMs = currentSlice[currentSlice.length-1][0];
  const schedule = pickSchedule(startMs, endMs, freq);

  // Compute
  const res = buildPortfolioSeries(currentSlice, schedule, amount, current);
  updateMainPriceSeries(currentSlice);
  plotPortfolioSeries(res.series);

  // Summary
  qs('#sumInvest').textContent = fmtMoney.format(res.totalInvested);
  qs('#sumTimes').textContent = `${res.times}x setoran ${freq}`;
  qs('#sumBTC').textContent = `${res.totalBTC.toFixed(6)} BTC`;
  qs('#sumValue').textContent = fmtMoney.format(res.finalValue);
  qs('#sumROI').textContent = fmtPct.format(res.roi);
  qs('#sumMeta').textContent = `${years}y • ${freq}`;

  // Store last for export
  window.__lastSingle = { years, freq, amount, invested:res.totalInvested, btc:res.totalBTC, value:res.finalValue, roi:res.roi, currency, series:res.series };

  if(showToastMsg) showToast('Selesai dihitung.');
}

// ========== Export ==========
function exportSingle(){
  const r = window.__lastSingle;
  if(!r){ showToast('Hitung dulu sebelum export'); return; }
  const header = ['durasi_years','frekuensi','nominal_setoran','setoran_total','btc_terkumpul','nilai_akhir','roi','currency'];
  const csv = [header.join(',')].concat([
    [r.years, r.freq, r.amount, Math.round(r.invested*100)/100, r.btc, Math.round(r.value*100)/100, r.roi, r.currency].join(',')
  ]).join('\n');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'btc_dca_single.csv'; document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

// ========== Wire-up ==========
makeSingleSelect('#durasiSet', 'years');
makeSingleSelect('#freqSet', 'freq');

document.getElementById('btnHitung').addEventListener('click', ()=> runSingleDCA(true));
document.getElementById('btnExport').addEventListener('click', exportSingle);
document.getElementById('dcaCurrency').addEventListener('change', async ()=>{
  await refreshLive();
  await onDurationChange();
});
document.getElementById('dcaAmount').addEventListener('change', ()=> runSingleDCA(false));

// Init
refreshLive(); setInterval(refreshLive, 30000);
initSpark();
onDurationChange(); // initial slice + dur %
