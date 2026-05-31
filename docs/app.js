const statusEl = document.getElementById('status');
const outputEl = document.getElementById('output');
const townInput = document.getElementById('townId');
const tokenInput = document.getElementById('apiToken');
const userInput = document.getElementById('apiUser');
const saveCreds = document.getElementById('saveCreds');
const loadBtn = document.getElementById('loadBtn');

// Restore saved creds if present
try{ if(localStorage){ const t = localStorage.getItem('merc_token'); const u = localStorage.getItem('merc_user'); if(t) tokenInput.value = t; if(u) userInput.value = u; } }catch(e){}
// Also allow pre-filling via URL query params ?token=...&user=...
try{
  const params = new URLSearchParams(window.location.search);
  const ut = params.get('token'); const uu = params.get('user'); const save = params.get('save');
  if(ut) tokenInput.value = ut;
  if(uu) userInput.value = uu;
  if(save && save === '1' && localStorage){ saveCreds.checked = true; localStorage.setItem('merc_token', ut||''); localStorage.setItem('merc_user', uu||''); }
}catch(e){}

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
  const cacheUrl = `cache/town_${encodeURIComponent(townId)}.json`;
  // If credentials provided via UI or URL, prefer direct authenticated fetch (skip cache)
  const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams('');
  const hasCreds = (tokenInput && tokenInput.value) || (userInput && userInput.value) || urlParams.get('token');
  if(!hasCreds){
    // Try cached static file first (served by GitHub Pages when available)
    try{
      const cres = await fetch(cacheUrl);
      if(cres.ok){
        const cjson = await cres.json();
        renderMarketOverview(cjson);
        setStatus('Loaded (cache).');
        return;
      }
    }catch(e){ /* ignore cache fetch errors */ }
  }

  const url = `${config.apiBase}/towns/${encodeURIComponent(townId)}/marketdata`;
  try{
    // Try direct fetch first (may fail in browser due to CORS)
    const headers = {};
    if(tokenInput && tokenInput.value){ headers['Authorization'] = 'Bearer ' + tokenInput.value.trim(); }
    if(userInput && userInput.value){ headers['X-Merc-User'] = userInput.value.trim(); }
    const res = await fetch(url, { headers });
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    renderMarketOverview(json);
    setStatus('Loaded (direct).');
    // Save creds if requested
    try{ if(saveCreds && saveCreds.checked && localStorage){ localStorage.setItem('merc_token', tokenInput.value || ''); localStorage.setItem('merc_user', userInput.value || ''); } }catch(e){}
    return;
  }catch(err){
    console.warn('Direct fetch failed, attempting CORS proxy fallback', err);
    // If it's a network/TypeError, it's frequently CORS or network related. Give specific instructions.
    const isNetwork = err && (err.name === 'TypeError' || String(err).toLowerCase().includes('failed to fetch'));
    if(isNetwork){
      setStatus('Network/CORS error when attempting direct fetch.');
      const host = window.location.origin + window.location.pathname;
      const example = `${host}?token=<YOUR_TOKEN>&user=<YOUR_EMAIL>`;
      outputEl.innerHTML = `
        <p>Direct requests from your browser may be blocked by the API (CORS). To try a live fetch from this browser you can:</p>
        <ol>
          <li>Paste your API token and email into the input fields above and click "Load Market Data".</li>
          <li>Or open this site with query parameters (insecure): <code>${escapeHtml(example)}</code></li>
          <li>If CORS still blocks requests, use the cached data or deploy a server-side proxy (see docs/DEPLOY.md).</li>
        </ol>
        <p style="color:#b91c1c">Warning: putting tokens in URLs or the page is insecure. Only do this for testing.</p>
      `;
      return;
    }
    // Fallback: use a public CORS proxy (for local testing). If this is undesirable for production, deploy a server-side proxy.
    try{
      setStatus('Direct fetch failed; trying CORS proxy...');
      const proxyUrl = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url);
      const pres = await fetch(proxyUrl);
      if(!pres.ok) throw new Error(`Proxy HTTP ${pres.status}`);
      const text = await pres.text();
      let json;
      try{ json = JSON.parse(text); }catch(parseErr){
        // If parsing fails, the proxy may have returned the raw JSON already or an error HTML.
        // Try to parse as-is; if still fails, throw.
        throw new Error('Failed to parse proxy response as JSON');
      }
      renderMarketOverview(json);
      setStatus('Loaded (via proxy).');
      return;
    }catch(proxyErr){
      console.error('Proxy fetch failed', proxyErr);
      setStatus('Error fetching API: '+(proxyErr.message||proxyErr)+'. See console for details.');
      outputEl.innerHTML = `<pre>${proxyErr.stack||proxyErr}</pre>`;
      // Fallback to local mock data so the UI remains usable during development
      try{ await loadMockData(); }catch(e){ console.warn('Mock load failed', e); }
    }
  }
}

function renderMarketOverview(data){
  if(!data || !data.markets){
    outputEl.textContent = 'No market data in response.'; return;
  }
  // Show fetched_at if present (added by GH Action)
  if(data.fetched_at){
    const meta = document.createElement('div');
    meta.style.fontSize = '0.9em';
    meta.style.color = '#6b7280';
    meta.textContent = 'Cached: ' + data.fetched_at;
    outputEl.appendChild(meta);
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

async function loadMockData(){
  setStatus('Loading mock data...');
  outputEl.innerHTML = '';
  try{
    const r = await fetch('sample_marketdata.json');
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    renderMarketOverview(j);
    setStatus('Loaded (mock).');
  }catch(e){
    console.error('Mock data load failed', e);
    setStatus('No mock data available: '+(e.message||e));
    outputEl.innerHTML = `<pre>${e.stack||e}</pre>`;
    throw e;
  }
}

loadConfig();
loadBtn.addEventListener('click', ()=>fetchMarketData(townInput.value));

// Auto-load once on start
window.addEventListener('load', ()=>fetchMarketData(townInput.value));
