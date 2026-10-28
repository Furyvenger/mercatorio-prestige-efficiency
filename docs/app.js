import { createChurchContracts } from './church-contracts.mjs';
import { fetchRecipeConfiguration, fetchRecipeProfits } from './recipe-profit-ranking.mjs';

const statusEl = document.getElementById('status');
const townInput = document.getElementById('townId');
const tokenInput = document.getElementById('apiToken');
const userInput = document.getElementById('apiUser');
const loadBtn = document.getElementById('loadBtn');
const TOWN_STORAGE_KEY = 'merc_town_id';

function saveUserPreferences(){
  try{
    if(!localStorage) return;
    localStorage.setItem(TOWN_STORAGE_KEY, townInput.value.trim());
    localStorage.setItem('merc_token', tokenInput.value || '');
    localStorage.setItem('merc_user', userInput.value || '');
  }catch(e){
    console.warn('Failed to save preferences to localStorage', e);
  }
}

// Restore saved preferences if present.
try{
  if(localStorage){
    const town = localStorage.getItem(TOWN_STORAGE_KEY);
    const token = localStorage.getItem('merc_token');
    const user = localStorage.getItem('merc_user');
    if(town) townInput.value = town;
    if(token) tokenInput.value = token;
    if(user) userInput.value = user;
  }
}catch(e){ console.warn('Failed to load preferences from localStorage', e); }

// Also allow pre-filling via URL query params ?token=...&user=...
try{
  const params = new URLSearchParams(window.location.search);
  const ut = params.get('token'); const uu = params.get('user');
  if(ut) tokenInput.value = ut;
  if(uu) userInput.value = uu;
}catch(e){}

let config = { apiBase: 'https://play.mercatorio.io/api' };

async function loadConfig(){
  try{
    const r = await fetch('config.json');
    if(r.ok) config = await r.json();
  }catch(e){ /* ignore, use defaults */ }
}

function setStatus(msg){ if(statusEl) statusEl.textContent = msg }

async function fetchMarketData(townId, options = {}){
  townId = String(townId || '').trim();
  if(!townId){
    setStatus('Enter a town ID to load market data.');
    return null;
  }
  saveUserPreferences();
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

async function fetchRecipes(){
  return fetchRecipeConfiguration({
    apiBase: config.apiBase,
    token: tokenInput?.value,
    user: userInput?.value
  });
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
const churchContracts = createChurchContracts({ getUnitPrice });

// Compute prestige costs using the current recipes from the Mercatorio API.
async function computePrestigeCosts(){
  setStatus('Computing prestige costs...');
  const townId = townInput.value;
  const data = await fetchMarketData(townId);
  if(!data){ setStatus('No market data available'); return; }
  const markets = data.markets || {};
  currentMarketData = data;

  let recipes;
  try{
    recipes = await fetchRecipes();
  }catch(e){ setStatus('Failed to load recipes: '+(e.message||e)); return; }

  // Production recipe prestige from the API is already in actual prestige units.
  recipes = recipes.filter(rcp => rcp.prestige && Number(rcp.prestige) != 0);
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
          const factor = 1 + 0.20 * Math.max(0, apprentices);
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

  // Load and restore saved contracts from localStorage
  const restored = churchContracts.restore(results, markets);
  const savedContracts = restored.contracts;
  currentPrestigeResults = restored.results;
  renderPrestigeResults(currentPrestigeResults, data);
  const contractCount = savedContracts.length;
  setStatus('Computed '+currentPrestigeResults.length+' methods'+(contractCount?' (+'+contractCount+' saved contracts)':'')+'.');
}

async function computeRecipeProfits(){
  const container = document.getElementById('profitResults');
  container.innerHTML = '';
  setStatus('Computing recipe profits...');
  saveUserPreferences();
  let result;
  try{
    result = await fetchRecipeProfits({
      townId: townInput.value,
      apiBase: config.apiBase,
      token: tokenInput?.value,
      user: userInput?.value,
      getUnitPrice,
      onProgress: setStatus,
      onMarketData: renderMarketOverview,
      pageUrl: window.location.origin + window.location.pathname
    });
  }catch(e){
    setStatus('Failed to load recipes: '+(e.message||e));
    return;
  }
  if(!result){ setStatus('No market data available'); return; }
  const { profits, failedProducts } = result;

  if(!profits.length){
    container.textContent = 'No recipes with inputs and outputs were returned.';
    return;
  }

  const table = document.createElement('table');
  table.className = 'table';
  table.innerHTML = '<thead><tr><th>#</th><th>Recipe</th><th>Output value</th><th>Input cost</th><th>Profit</th><th>Details</th></tr></thead>';
  const tbody = document.createElement('tbody');
  profits.forEach((recipe, index) => {
    const unavailable = recipe.missing.length > 0;
    const profitDisplay = unavailable ? '?' : recipe.profit.toFixed(2);
    const row = document.createElement('tr');
    const profitClass = unavailable ? '' : (recipe.profit >= 0 ? 'profit-positive' : 'profit-negative');
    row.innerHTML = `<td>${index + 1}</td><td>${escapeHtml(recipe.name)}</td><td>${unavailable ? '?' : recipe.outputValue.toFixed(2)}</td><td>${unavailable ? '?' : recipe.inputCost.toFixed(2)}</td><td class="${profitClass}">${profitDisplay}</td><td><button class="detailsBtn" data-profit-idx="${index}">Details</button></td>`;
    tbody.appendChild(row);
  });
  table.appendChild(tbody);
  container.appendChild(table);

  table.addEventListener('click', event => {
    if(!event.target.classList.contains('detailsBtn')) return;
    const recipe = profits[Number(event.target.dataset.profitIdx)];
    const detail = document.createElement('div');
    detail.className = 'table-details-content';
    const unfilled = recipe.breakdown
      .filter(item => item.type === 'output' && item.unsold > 0)
      .map(item => `${item.product} (${item.unsold})`);
    detail.innerHTML = `<h3>${escapeHtml(recipe.name)}</h3><p>Production level: ${(recipe.productionRatio * 100).toFixed(2)}% of one recipe</p><p>Missing input prices: ${recipe.missing.length ? escapeHtml(recipe.missing.join(', ')) : 'none'}</p><p>Unfilled output demand: ${unfilled.length ? escapeHtml(unfilled.join(', ')) : 'none'}</p>`;
    const list = document.createElement('ul');
    recipe.breakdown.forEach(item => {
      const price = item.unitPrice == null ? '?' : item.unitPrice.toFixed(2);
      const extra = item.type === 'output' ? `; unfilled: ${item.unsold}` : '';
      list.innerHTML += `<li>${item.type === 'output' ? 'Output sold' : 'Input'}: ${escapeHtml(item.product)} — ${item.amount} × ${price} = ${item.unitPrice == null ? '?' : item.value.toFixed(2)}${extra}</li>`;
      if(item.type === 'output' && item.fills && item.fills.length){
        list.innerHTML += `<li class="market-fill-details">Buy-order fills: ${item.fills.map(fill => `${fill.amount} @ ${fill.price}`).join(', ')}</li>`;
      }
    });
    detail.appendChild(list);
    const existing = container.querySelector('.table-details-content');
    if(existing) existing.remove();
    container.appendChild(detail);
  });
  setStatus('Loaded '+profits.length+' recipe profit rankings.'+
    (failedProducts.length ? ' Buy orders unavailable for '+failedProducts.length+' product(s); those outputs show no proceeds.' : ''));
}

function addContract(){
  const result = churchContracts.add(currentPrestigeResults, currentMarketData, {
    product: document.getElementById('contractProduct')?.value,
    amount: document.getElementById('contractAmount')?.value,
    prestige: document.getElementById('contractPrestige')?.value
  });
  if(!result.added){
    setStatus(result.status);
    return;
  }
  currentPrestigeResults = result.results;
  document.getElementById('contractProduct').value = '';
  document.getElementById('contractAmount').value = '1';
  document.getElementById('contractPrestige').value = '1';
  
  renderPrestigeResults(currentPrestigeResults, currentMarketData);
  setStatus(result.status);
}

function renderPrestigeResults(results, data){
  const container = document.getElementById('prestigeResults');
  container.innerHTML = '';
  // Apply client-side filters (if the filter checkboxes exist)
  try{
    const fRecipe = document.getElementById('filterRecipe')?.checked ?? true;
    const fHouse = document.getElementById('filterHousehold')?.checked ?? true;
    const fBuild = document.getElementById('filterBuilding')?.checked ?? true;
    const fContract = document.getElementById('filterContract')?.checked ?? true;
    results = (results || []).filter(r => {
      if(r.source === 'recipe') return fRecipe;
      if(r.source === 'household') return fHouse;
      if(r.source === 'building') return fBuild;
      if(r.source === 'contract') return fContract;
      return true;
    });
  }catch(e){ /* ignore and show all */ }

  if(!results || results.length === 0){
    const msg = document.createElement('div');
    msg.textContent = 'No results to show for selected filters.';
    msg.style.padding = '12px';
    container.appendChild(msg);
    return;
  }

  const table = document.createElement('table'); table.className = 'table';
  const thead = document.createElement('thead'); thead.innerHTML = '<tr><th>Recipe</th><th>Prestige</th><th>Amount</th><th>Cost</th><th>Cost / prestige</th><th>Details</th></tr>';
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  results.forEach((r, idx)=>{
    const costDisplay = r.missing.length ? '?' : r.totalCost.toFixed(2);
    const cppDisplay = (r.costPerPrestige==null ? '?' : r.costPerPrestige.toFixed(4));
    // Determine amount to display
    let amountDisplay = '1';
    if(r.source === 'household' || r.source === 'contract'){
      // For household and contracts, show the amount from the single input
      if(r.breakdown && r.breakdown.length > 0){
        amountDisplay = r.breakdown[0].amount.toFixed(2);
      }
    }
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${escapeHtml(r.name)}</td><td>${r.prestige}</td><td>${amountDisplay}</td><td>${costDisplay}</td><td>${cppDisplay}</td><td><button data-idx="${idx}" class="detailsBtn">Details</button></td>`;
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
      const src = data && data.fetched_at ? 'cache' : 'live';
      detailDiv.appendChild(document.createElement('hr'));
      const meta = document.createElement('div'); meta.style.fontSize='0.9em'; meta.style.color='#6b7280'; meta.textContent = 'Prices source: '+src; detailDiv.appendChild(meta);
      const existing = container.querySelector('.detail');
      if(existing) existing.remove();
      container.appendChild(detailDiv);
    }
  });
}

loadConfig();
townInput.addEventListener('input', saveUserPreferences);
tokenInput.addEventListener('input', saveUserPreferences);
userInput.addEventListener('input', saveUserPreferences);
loadBtn.addEventListener('click', ()=>fetchMarketData(townInput.value));
const computeBtn = document.getElementById('computeBtn');
if(computeBtn) computeBtn.addEventListener('click', ()=>computePrestigeCosts());
const computeProfitBtn = document.getElementById('computeProfitBtn');
if(computeProfitBtn) computeProfitBtn.addEventListener('click', ()=>computeRecipeProfits());
const addContractBtn = document.getElementById('addContractBtn');
if(addContractBtn) addContractBtn.addEventListener('click', ()=>addContract());
const clearContractsBtn = document.getElementById('clearContractsBtn');
if(clearContractsBtn) clearContractsBtn.addEventListener('click', ()=>{
  currentPrestigeResults = churchContracts.clear(currentPrestigeResults);
  renderPrestigeResults(currentPrestigeResults, currentMarketData);
  setStatus('All contracts cleared.');
});

// Re-render when filters change
['filterRecipe','filterHousehold','filterBuilding','filterContract'].forEach(id=>{
  const el = document.getElementById(id);
  if(el) el.addEventListener('change', ()=>renderPrestigeResults(currentPrestigeResults, currentMarketData));
});

document.querySelectorAll('.tab-button').forEach(button=>{
  button.addEventListener('click', ()=>{
    document.querySelectorAll('.tab-button').forEach(tab=>tab.classList.toggle('active', tab === button));
    document.querySelectorAll('.tab-page').forEach(page=>{
      const active = page.id === button.dataset.tab;
      page.hidden = !active;
      page.classList.toggle('active', active);
    });
  });
});

// Auto-load only when a town ID has been saved.
window.addEventListener('load', ()=>{
  if(townInput.value.trim()) fetchMarketData(townInput.value);
  else setStatus('Enter a town ID to load market data.');
});
