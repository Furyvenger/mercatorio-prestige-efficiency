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

function setStatus(msg){ if(statusEl) statusEl.textContent = msg }

function clearOutput(){ if(outputEl) outputEl.innerHTML = ''; } 

async function fetchMarketData(townId, options = { forceCache: false }){
  setStatus('Fetching market overview...');
  clearOutput();
  const cacheUrl = `cache/town_${encodeURIComponent(townId)}.json`;
  // If credentials provided via UI or URL, prefer direct authenticated fetch (skip cache) unless forceCache is set
  const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams('');
  const hasCreds = (tokenInput && tokenInput.value) || (userInput && userInput.value) || urlParams.get('token');
  const preferCache = options.forceCache || (document.getElementById('useCache') && document.getElementById('useCache').checked);

  if(preferCache || !hasCreds){
    // Try cached static file first (served by GitHub Pages when available)
    try{
      const cres = await fetch(cacheUrl);
      if(cres.ok){
        const cjson = await cres.json();
        renderMarketOverview(cjson);
        setStatus('Loaded (cache).');
        return cjson;
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
    return json;
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
      return null;
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
      return json;
    }catch(proxyErr){
      console.error('Proxy fetch failed', proxyErr);
      setStatus('Error fetching API: '+(proxyErr.message||proxyErr)+'. See console for details.');
            if(outputEl) outputEl.innerHTML = `<pre>${proxyErr.stack||proxyErr}</pre>`;
      // Fallback to local mock data so the UI remains usable during development
      try{ const mock = await loadMockData(); return mock; }catch(e){ console.warn('Mock load failed', e); return null; }
    }
  }
}

function renderMarketOverview(data){
  // Do not render the full market table — only keep minimal metadata for prestige computations.
  clearOutput();
  if(data && data.fetched_at && outputEl){
    const meta = document.createElement('div');
    meta.style.fontSize = '0.9em';
    meta.style.color = '#6b7280';
    meta.textContent = 'Prices cached: ' + data.fetched_at;
    outputEl.appendChild(meta);
  }
}

function fmt(v){ return v==null?'-':String(v) }
function escapeHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') }

async function loadMockData(){
  setStatus('Loading mock data...');
  clearOutput();
  try{
    const r = await fetch('sample_marketdata.json');
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    renderMarketOverview(j);
    setStatus('Loaded (mock).');
    return j;
  }catch(e){
    console.error('Mock data load failed', e);
    setStatus('No mock data available: '+(e.message||e));
    if(outputEl) outputEl.innerHTML = `<pre>${e.stack||e}</pre>`;
    return null;
  }
}

// Helper: determine unit price for a product from markets map
function getUnitPrice(markets, product){
  if(!markets || !product) return null;
  const m = markets[product];
  if(!m) return null;
  if(m.last_price != null) return Number(m.last_price);
  if(m.highest_bid != null && m.lowest_ask != null) return (Number(m.highest_bid) + Number(m.lowest_ask)) / 2;
  return null;
}

// Compute prestige costs using recipes_season_7.json from this repo (raw github URL)
async function computePrestigeCosts(){
  setStatus('Computing prestige costs...');
  const townId = townInput.value;
  const preferCache = document.getElementById('useCache') && document.getElementById('useCache').checked;
  const data = await fetchMarketData(townId, { forceCache: preferCache });
  if(!data){ setStatus('No market data available'); return; }
  const markets = data.markets || {};

  let recipesObj;
  try{
    const r = await fetch('https://raw.githubusercontent.com/Furyvenger/mercatorio-prestige-efficiency/main/recipes_season_7.json');
    if(!r.ok) throw new Error('HTTP '+r.status);
    recipesObj = await r.json();
  }catch(e){ setStatus('Failed to load recipes: '+(e.message||e)); return; }

  const recipes = Object.values(recipesObj).filter(rcp => rcp.prestige && Number(rcp.prestige) != 0);
  // Load household entries (if present) and normalize (robust parser)
  let householdEntries = [];
  async function tryParseHouseholdText(text){
    if(!text) return null;
    try{ return JSON.parse(text); }catch(e){
      // Attempt to convert JS-style object literal to JSON: quote unquoted keys and normalize quotes
      try{
        let t = text.replace(/([\{,\s])([a-zA-Z0-9_\-]+)\s*:/g, '$1"$2":');
        t = t.replace(/\'/g, '"');
        return JSON.parse(t);
      }catch(e2){
        console.warn('Household parse fallback failed', e2);
        return null;
      }
    }
  }

  try{
    const candidates = [
      'docs/household.json',
      'household.json',
      '../household.json',
      '/household.json',
      'https://raw.githubusercontent.com/Furyvenger/mercatorio-prestige-efficiency/main/household.json'
    ];
    for(const url of candidates){
      try{
        const res = await fetch(url);
        if(!res.ok) continue;
        const txt = await res.text();
        const parsed = await tryParseHouseholdText(txt);
        if(parsed && Array.isArray(parsed)){
          const apprentices = Number(document.getElementById('apprentices')?.value || 0);
          const factor = 1 + 0.25 * Math.max(0, apprentices);
          householdEntries = parsed.map(h => {
            let amt = Number(h.volume||0);
            // apprentices increase household consumption excluding gear and luxury
            if(!h.category || !['gear','luxury'].includes(h.category)){
              amt = amt * factor;
            }
            return {
              name: (h.product || 'household') + (h.category ? ` (${h.category})` : ' (household)'),
              inputs: [{ product: h.product, amount: amt }],
              prestige: Number(h.prestige||0),
              source: 'household',
              category: h.category || null,
              raw: h
            };
          });
          setStatus('Loaded '+householdEntries.length+' household entries from '+url+(apprentices?(' (apprentices x'+apprentices+', factor '+factor.toFixed(2)+')') : ''));
          break;
        }
      }catch(e){ /* try next */ }
    }
  }catch(e){ /* ignore */ }

  // Load buildings (if present) and normalize into entries
  let buildingEntries = [];
  try{
    const bCandidates = ['docs/buildings.json','buildings.json','https://raw.githubusercontent.com/Furyvenger/mercatorio-prestige-efficiency/main/docs/buildings.json','https://raw.githubusercontent.com/Furyvenger/mercatorio-prestige-efficiency/main/buildings.json'];
    for(const url of bCandidates){
      try{
        const res = await fetch(url);
        if(!res.ok) continue;
        const arr = await res.json();
        if(!Array.isArray(arr)) continue;
        // Expect each building to have name, materials: [{product, amount}], prestige (optional)
        buildingEntries = arr.filter(b => b.prestige && Number(b.prestige) != 0).map(b => ({
          name: b.name || ('building'),
          inputs: (b.materials || []).map(m => ({ product: m.product, amount: Number(m.amount||0) })),
          // buildings prestige must be multiplied by 100
          prestige: Number(b.prestige||0) * 100,
          source: 'building',
          raw: b
        }));
        if(buildingEntries.length) setStatus('Loaded '+buildingEntries.length+' building entries from '+url);
        break;
      }catch(e){ /* try next */ }
    }
  }catch(e){ /* ignore */ }

  const results = [];
  // Combine recipe entries, household entries and building entries; mark source for recipes
  const allEntries = [];
  recipes.forEach(r=> allEntries.push(Object.assign({ source: 'recipe' }, r)));
  householdEntries.forEach(h=> allEntries.push(h));
  buildingEntries.forEach(b=> allEntries.push(b));

  for(const rec of allEntries){
    const inputs = rec.inputs || [];
    let totalCost = 0;
    const missing = [];
    const breakdown = [];
    for(const inp of inputs){
      const amt = Number(inp.amount || 0);
      const prod = inp.product;
      const unitPrice = getUnitPrice(markets, prod);
      if(unitPrice == null) missing.push(prod);
      const cost = (unitPrice == null ? 0 : unitPrice * amt);
      breakdown.push({ product: prod, amount: amt, unitPrice: unitPrice, cost });
      totalCost += cost;
    }
    let prestige = Number(rec.prestige || 0);
    // If this came from the recipes file (which used small numbers), ensure scale (recipes already scaled earlier elsewhere)
    if(rec.source === 'recipe') prestige = prestige * 100;
    let costPerPrestige = null;
    if(missing.length === 0 && prestige > 0){
      costPerPrestige = totalCost / prestige;
    }
    results.push({ name: rec.name || rec.product || '', prestige, totalCost, costPerPrestige, missing, breakdown, recipe: rec, source: rec.source || 'recipe' });
  }

  // Sort: entries without missing prices first (ascending cost), then entries with missing prices
  results.sort((a,b)=>{
    if(a.missing.length && !b.missing.length) return 1;
    if(!a.missing.length && b.missing.length) return -1;
    if(a.costPerPrestige == null && b.costPerPrestige == null) return a.name.localeCompare(b.name);
    if(a.costPerPrestige == null) return 1;
    if(b.costPerPrestige == null) return -1;
    return a.costPerPrestige - b.costPerPrestige;
  });

  renderPrestigeResults(results, data);
  setStatus('Computed '+results.length+' methods.');
}

function renderPrestigeResults(results, data){
  const container = document.getElementById('prestigeResults');
  container.innerHTML = '';
  const table = document.createElement('table'); table.className = 'table';
  const thead = document.createElement('thead'); thead.innerHTML = '<tr><th>Recipe</th><th>Prestige</th><th>Cost</th><th>Cost / prestige</th><th>Missing</th><th>Details</th></tr>';
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  results.forEach((r, idx)=>{
    const costDisplay = r.missing.length ? '?' : r.totalCost.toFixed(2);
    const cppDisplay = (r.costPerPrestige==null ? '?' : r.costPerPrestige.toFixed(4));
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${escapeHtml(r.name)}</td><td>${r.prestige}</td><td>${costDisplay}</td><td>${cppDisplay}</td><td>${r.missing.length}</td><td><button data-idx="${idx}" class="detailsBtn">Details</button></td>`;
    // Highlight household-derived methods
    if(r.source === 'household'){
      tr.style.background = '#fff7cc';
    }
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  container.appendChild(table);

  container.addEventListener('click', (e)=>{
    if(e.target && e.target.classList.contains('detailsBtn')){
      const i = Number(e.target.getAttribute('data-idx'));
      const r = results[i];
      const detailDiv = document.createElement('div');
      detailDiv.className = 'detail';
      detailDiv.innerHTML = `<h3>${escapeHtml(r.name)}</h3><p>Prestige: ${r.prestige}</p><p>Total cost: ${r.missing.length ? '?' : r.totalCost.toFixed(2)}</p><p>Cost per prestige: ${r.costPerPrestige==null? '?' : r.costPerPrestige.toFixed(4)}</p>`;
      const list = document.createElement('ul');
      r.breakdown.forEach(b=>{
        const up = b.unitPrice==null? '?' : b.unitPrice;
        const cost = (b.unitPrice==null? '?' : b.cost.toFixed(2));
        list.innerHTML += `<li>${escapeHtml(b.product)} — amount: ${b.amount}, unitPrice: ${up}, cost: ${cost}</li>`;
      });
      detailDiv.appendChild(list);
      const src = data.fetched_at ? 'cache' : 'live';
      detailDiv.appendChild(document.createElement('hr'));
      const meta = document.createElement('div'); meta.style.fontSize='0.9em'; meta.style.color='#6b7280'; meta.textContent = 'Prices source: '+src; detailDiv.appendChild(meta);
      const existing = container.querySelector('.detail');
      if(existing) existing.remove();
      container.appendChild(detailDiv);
    }
  });
}

loadConfig();
loadBtn.addEventListener('click', ()=>fetchMarketData(townInput.value));
const computeBtn = document.getElementById('computeBtn');
if(computeBtn) computeBtn.addEventListener('click', ()=>computePrestigeCosts());

// Auto-load once on start
window.addEventListener('load', ()=>fetchMarketData(townInput.value));
