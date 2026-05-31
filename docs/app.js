const statusEl = document.getElementById('status');
const outputEl = document.getElementById('output');
const townInput = document.getElementById('townId');
const loadBtn = document.getElementById('loadBtn');

let config = { apiBase: 'https://play.mercatorio.io/api', defaultTownId: '1' };

async function loadConfig(){
  try{
    const r = await fetch('config.json');
    if(r.ok) config = await r.json();
  }catch(e){ /* ignore, use defaults */ }
  townInput.value = config.defaultTownId || townInput.value;
}

function setStatus(msg){ statusEl.textContent = msg }

async function fetchMarketData(townId){
  setStatus('Fetching market overview...');
  outputEl.innerHTML = '';
  try{
    const url = `${config.apiBase}/towns/${encodeURIComponent(townId)}/marketdata`;
    const res = await fetch(url);
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    renderMarketOverview(json);
    setStatus('Loaded.');
  }catch(err){
    console.error(err);
    setStatus('Error fetching API: '+err.message + '. If this is a CORS error, consider deploying a proxy.');
    outputEl.innerHTML = `<pre>${err.stack||err}</pre>`;
  }
}

function renderMarketOverview(data){
  if(!data || !data.markets){
    outputEl.textContent = 'No market data in response.'; return;
  }
  const markets = data.markets;
  const table = document.createElement('table');
  table.className = 'table';
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>Product</th><th>Last price</th><th>Highest bid</th><th>Lowest ask</th><th>Volume</th></tr>';
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  Object.keys(markets).forEach(product => {
    const m = markets[product];
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${escapeHtml(product)}</td><td>${fmt(m.last_price)}</td><td>${fmt(m.highest_bid)}</td><td>${fmt(m.lowest_ask)}</td><td>${fmt(m.volume)}</td>`;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  outputEl.appendChild(table);
}

function fmt(v){ return v==null?'-':String(v) }
function escapeHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') }

loadConfig();
loadBtn.addEventListener('click', ()=>fetchMarketData(townInput.value));

// Auto-load once on start
window.addEventListener('load', ()=>fetchMarketData(townInput.value));
