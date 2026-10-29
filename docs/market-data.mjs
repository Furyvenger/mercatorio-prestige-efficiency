export function createAuthHeaders(token, user, includeAccept = false){
  const headers = includeAccept ? { 'Accept': 'application/json' } : {};
  if(token) headers.Authorization = 'Bearer ' + String(token).trim();
  if(user) headers['X-Merc-User'] = String(user).trim();
  return headers;
}

function report(onProgress, message){
  if(onProgress) onProgress(message);
}

export async function loadMarketData({
  townId,
  apiBase,
  token,
  user,
  fetchImpl = fetch,
  onProgress,
  onMarketData,
  pageUrl = ''
}){
  townId = String(townId || '').trim();
  if(!townId){
    report(onProgress, 'Enter a town ID to load market data.');
    return null;
  }

  report(onProgress, 'Fetching market data...');
  const url = `${apiBase}/towns/${encodeURIComponent(townId)}/marketdata`;
  try{
    const response = await fetchImpl(url, {
      headers: createAuthHeaders(token, user)
    });
    if(!response.ok) throw new Error(`HTTP ${response.status}`);
    const marketData = await response.json();
    if(onMarketData) onMarketData(marketData);
    report(onProgress, 'Loaded (direct).');
    return marketData;
  }catch(error){
    console.warn('Direct fetch failed, attempting CORS proxy fallback', error);
    const isNetwork = error && (
      error.name === 'TypeError' ||
      String(error).toLowerCase().includes('failed to fetch')
    );
    if(isNetwork){
      const example = `${pageUrl}?token=<YOUR_TOKEN>&user=<YOUR_EMAIL>`;
      report(onProgress, `Network/CORS error when attempting direct fetch.
Direct requests from your browser may be blocked by the API (CORS). To try a live fetch from this browser you can:
1. Paste your API token and email into the input fields above and click "Load Market Data".
2. Or open this site with query parameters (insecure): ${example}
3. If CORS still blocks requests, deploy a server-side proxy (see docs/DEPLOY.md).

Warning: putting tokens in URLs or the page is insecure. Only do this for testing.`);
      return null;
    }

    try{
      report(onProgress, 'Direct fetch failed; trying CORS proxy...');
      const proxyUrl = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url);
      const response = await fetchImpl(proxyUrl);
      if(!response.ok) throw new Error(`Proxy HTTP ${response.status}`);
      let marketData;
      try{
        marketData = JSON.parse(await response.text());
      }catch{
        throw new Error('Failed to parse proxy response as JSON');
      }
      if(onMarketData) onMarketData(marketData);
      report(onProgress, 'Loaded (via proxy).');
      return marketData;
    }catch(proxyError){
      console.error('Proxy fetch failed', proxyError);
      report(onProgress, 'Error fetching API: '+(proxyError.message || proxyError)+'. See console for details.');
      return null;
    }
  }
}
