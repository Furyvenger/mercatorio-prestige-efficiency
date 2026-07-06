const statusEl = document.getElementById('status');
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

async function fetchMarketData(townId, options = {}){
  setStatus('Fetching market data...');
  const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams('');
  const hasCreds = (tokenInput && tokenInput.value) || (userInput && userInput.value) || urlParams.get('token');

  const url = `${config.apiBase}/towns/${encodeURIComponent(townId)}/marketdata`;
  try{
    // Try direct fetch with credentials if available
    const headers = {};
    if(tokenInput && tokenInput.value){ headers['Authorization'] = 'Bearer ' + tokenInput.value.trim(); }
    if(userInput && userInput.value){ headers['X-Merc-User'] = userInput.value.trim(); }
    
    // Log what we're sending (for debugging)
    if(tokenInput && tokenInput.value) console.log('Sending Authorization header');
    if(userInput && userInput.value) console.log('Sending X-Merc-User header: ' + userInput.value);
    
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
      const msg = `
Direct requests from your browser may be blocked by the API (CORS). To try a live fetch from this browser you can:
1. Paste your API token and email into the input fields above and click "Load Market Data".
2. Or open this site with query parameters (insecure): ${example}
3. If CORS still blocks requests, deploy a server-side proxy (see docs/DEPLOY.md).

Warning: putting tokens in URLs or the page is insecure. Only do this for testing.`;
      setStatus(msg);
      return null;
    }
    // Fallback: use a public CORS proxy (for local testing only)
    try{
      setStatus('Direct fetch failed; trying CORS proxy...');
      const proxyUrl = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url);
      const pres = await fetch(proxyUrl);
      if(!pres.ok) throw new Error(`Proxy HTTP ${pres.status}`);
      const text = await pres.text();
      let json;
      try{ json = JSON.parse(text); }catch(parseErr){
        throw new Error('Failed to parse proxy response as JSON');
      }
      renderMarketOverview(json);
      setStatus('Loaded (via proxy).');
      return json;
    }catch(proxyErr){
      console.error('Proxy fetch failed', proxyErr);
      setStatus('Error fetching API: '+(proxyErr.message||proxyErr)+'. See console for details.');
      return null;
    }
  }
}

function renderMarketOverview(data){
  // Minimal rendering - just show a status message
  if(data && data.fetched_at){
    setStatus('Market data loaded: ' + data.fetched_at);
  }
}

function fmt(v){ return v==null?'-':String(v) }
function escapeHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') }

// Helper: determine unit price for a product from markets map
function getUnitPrice(markets, product){
  if(!markets || !product) return null;
  const m = markets[product];
  if(!m) return null;
  
  const volume = Number(m.volume || 0);
  const lastPrice = m.last_price != null ? Number(m.last_price) : null;
  const lowestAsk = m.lowest_ask != null ? Number(m.lowest_ask) : null;
  
  // If volume > 0, use last_price (most recent actual trade)
  if(volume > 0 && lastPrice != null) return lastPrice;
  
  // If volume = 0 (no recent trades), use lowest_ask (next best price)
  if(volume === 0 && lowestAsk != null) return lowestAsk;
  
  // If no volume and no ask price, consider it missing
  return null;
}

let currentPrestigeResults = []; // store results so contracts can be added
let currentMarketData = null;
const CONTRACTS_STORAGE_KEY = 'mercatorio_contracts';

function saveContractsToStorage(contracts){
  try{
    localStorage.setItem(CONTRACTS_STORAGE_KEY, JSON.stringify(contracts));
  }catch(e){
    console.warn('Failed to save contracts to localStorage', e);
  }
}

function loadContractsFromStorage(){
  try{
    const stored = localStorage.getItem(CONTRACTS_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  }catch(e){
    console.warn('Failed to load contracts from localStorage', e);
    return [];
  }
}

function clearContractsFromStorage(){
  try{
    localStorage.removeItem(CONTRACTS_STORAGE_KEY);
  }catch(e){
    console.warn('Failed to clear contracts from localStorage', e);
  }
}

// Compute prestige costs using recipes_season_7.json from this repo (raw github URL)
async function computePrestigeCosts(){
  setStatus('Computing prestige costs...');
  const townId = townInput.value;
  const data = await fetchMarketData(townId);
  if(!data){ setStatus('No market data available'); return; }
  const markets = data.markets || {};
  currentMarketData = data;

  let recipesObj;
  try{
    // prefer local copy relative to the served docs root; fallback to raw github if missing
    let r = await fetch('recipes_season_7.json');
    if(!r.ok){
      r = await fetch('https://raw.githubusercontent.com/Furyvenger/mercatorio-prestige-efficiency/main/recipes_season_7.json');
      if(!r.ok) throw new Error('HTTP '+r.status);
    }
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
      'household.json',
      'docs/household.json',
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
  let buildingsAll = [];
  let buildingEntries = [];
  try{
    const bCandidates = ['buildings.json','https://raw.githubusercontent.com/Furyvenger/mercatorio-prestige-efficiency/main/docs/buildings.json'];
    for(const url of bCandidates){
      try{
        const res = await fetch(url);
        if(!res.ok) continue;
        const arr = await res.json();
        if(!Array.isArray(arr)) continue;
        // keep full buildings array for tax lookups
        buildingsAll = arr;
        // Expect each building to have type, construction.materials (object) or materials (object/array), prestige (optional)
        buildingEntries = arr.filter(b => b.prestige && Number(b.prestige) != 0).map(b => {
          // find materials object/array
          const mats = b.materials || (b.construction && b.construction.materials) || {};
          let inputs = [];
          if(Array.isArray(mats)){
            inputs = mats.map(m => ({ product: m.product, amount: Number(m.amount||0) }));
          }else if(mats && typeof mats === 'object'){
            inputs = Object.keys(mats).map(k => ({ product: k, amount: Number(mats[k]||0) }));
          }
          // buildings prestige must be multiplied by 100
          const prestige = Number(b.prestige||0) * 100;
          return {
            name: b.type || b.name || 'building',
            inputs,
            prestige,
            source: 'building',
            raw: b
          };
        });
        if(buildingEntries.length) {
          console.log('Loaded '+buildingEntries.length+' building entries from '+url);
          setStatus('Loaded '+buildingEntries.length+' building entries from '+url);
        }
        break;
      }catch(e){ console.warn('Building fetch failed from '+url, e); }
    }
  }catch(e){ console.warn('Building load error', e); }

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
    if(rec.source === 'recipe'){
      // recipe prestige scale
      prestige = prestige * 100;
    }
    // apply taxes for recipes: determine building site
    if(rec.source === 'recipe'){
      const site = rec.site || (rec.recipe && rec.recipe.site) || null;
      let tax = 0.5;
      if(typeof buildingsAll !== 'undefined' && site){
        const bdef = buildingsAll.find(b=>b.type === site);
        if(bdef && bdef.requires && bdef.requires.center === true) tax = 6;
        else tax = 0.5;
      }
      totalCost += tax;
    }
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

  // Load and restore saved contracts from localStorage
  const savedContracts = loadContractsFromStorage();
  for(const contract of savedContracts){
    const unitPrice = getUnitPrice(markets, contract.product);
    const totalCost = (unitPrice || 0) * contract.amount;
    const costPerPrestige = contract.prestige > 0 ? totalCost / contract.prestige : null;
    results.push({
      name: contract.product + ' (contract)',
      prestige: contract.prestige,
      totalCost,
      costPerPrestige,
      missing: unitPrice == null ? [contract.product] : [],
      breakdown: [{ product: contract.product, amount: contract.amount, unitPrice, cost: totalCost }],
      source: 'contract'
    });
  }

  // Re-sort after adding restored contracts
  results.sort((a,b)=>{
    if(a.missing.length && !b.missing.length) return 1;
    if(!a.missing.length && b.missing.length) return -1;
    if(a.costPerPrestige == null && b.costPerPrestige == null) return a.name.localeCompare(b.name);
    if(a.costPerPrestige == null) return 1;
    if(b.costPerPrestige == null) return -1;
    return a.costPerPrestige - b.costPerPrestige;
  });

  currentPrestigeResults = results;
  renderPrestigeResults(results, data);
  const contractCount = savedContracts.length;
  setStatus('Computed '+results.length+' methods'+(contractCount?' (+'+contractCount+' saved contracts)':'')+'.');
}

function addContract(){
  const product = document.getElementById('contractProduct')?.value?.trim();
  const amount = Number(document.getElementById('contractAmount')?.value || 1);
  const prestige = Number(document.getElementById('contractPrestige')?.value || 1);
  
  if(!product || amount <= 0 || prestige <= 0){
    setStatus('Please fill in product name, amount, and prestige.');
    return;
  }
  
  if(!currentPrestigeResults || !currentMarketData){
    setStatus('Please compute prestige first.');
    return;
  }
  
  const markets = currentMarketData.markets || {};
  const unitPrice = getUnitPrice(markets, product);
  const totalCost = (unitPrice || 0) * amount;
  const costPerPrestige = prestige > 0 ? totalCost / prestige : null;
  
  const entry = {
    name: product + ' (contract)',
    prestige,
    totalCost,
    costPerPrestige,
    missing: unitPrice == null ? [product] : [],
    breakdown: [{ product, amount, unitPrice, cost: totalCost }],
    source: 'contract'
  };
  
  currentPrestigeResults.push(entry);
  
  // Save contract to localStorage (just the essential data for recreation)
  const storedContracts = loadContractsFromStorage();
  storedContracts.push({ product, amount, prestige });
  saveContractsToStorage(storedContracts);
  
  // re-sort and render
  currentPrestigeResults.sort((a,b)=>{
    if(a.missing.length && !b.missing.length) return 1;
    if(!a.missing.length && b.missing.length) return -1;
    if(a.costPerPrestige == null && b.costPerPrestige == null) return a.name.localeCompare(b.name);
    if(a.costPerPrestige == null) return 1;
    if(b.costPerPrestige == null) return -1;
    return a.costPerPrestige - b.costPerPrestige;
  });
  
  document.getElementById('contractProduct').value = '';
  document.getElementById('contractAmount').value = '1';
  document.getElementById('contractPrestige').value = '1';
  
  renderPrestigeResults(currentPrestigeResults, currentMarketData);
  setStatus('Contract added and saved.');
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
    // Highlight with CSS classes based on source
    if(r.source === 'household'){
      tr.classList.add('row-household');
    } else if(r.source === 'building'){
      tr.classList.add('row-building');
    } else if(r.source === 'contract'){
      tr.classList.add('row-contract');
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
const addContractBtn = document.getElementById('addContractBtn');
if(addContractBtn) addContractBtn.addEventListener('click', ()=>addContract());
const clearContractsBtn = document.getElementById('clearContractsBtn');
if(clearContractsBtn) clearContractsBtn.addEventListener('click', ()=>{
  clearContractsFromStorage();
  setStatus('All contracts cleared.');
});

// Auto-load once on start
window.addEventListener('load', ()=>fetchMarketData(townInput.value));
