addEventListener('fetch', event => {
  event.respondWith(handle(event.request));
});

const ALLOWED_ORIGIN = typeof ALLOWED_ORIGIN !== 'undefined' ? ALLOWED_ORIGIN : '*';

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '*';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN === '*' ? '*' : ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, X-Merc-User, Content-Type',
    'Access-Control-Max-Age': '600'
  };
}

async function handle(request){
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }

  const url = new URL(request.url);
  // Accept town via query ?town=ID or path /towns/<id>
  let town = url.searchParams.get('town');
  if(!town){
    const m = url.pathname.match(/\/towns\/(\d+)\/marketdata/);
    if(m) town = m[1];
  }
  if(!town){
    return new Response(JSON.stringify({ error: 'missing town id' }), { status: 400, headers: { 'Content-Type':'application/json', ...corsHeaders(request) } });
  }

  const apiUrl = `https://play.mercatorio.io/api/towns/${encodeURIComponent(town)}/marketdata`;

  const headers = { 'Accept': 'application/json' };
  // Use secret-bound token (set as environment variable on the Worker)
  try{
    if (typeof MERCATORIO_API_TOKEN !== 'undefined' && MERCATORIO_API_TOKEN) {
      headers['Authorization'] = 'Bearer ' + MERCATORIO_API_TOKEN;
    }
  }catch(e){}
  // Use secret-bound user (email) or fall back to caller-provided X-Merc-User header
  try{
    if (typeof MERCATORIO_API_USER !== 'undefined' && MERCATORIO_API_USER) {
      headers['X-Merc-User'] = MERCATORIO_API_USER;
    } else {
      const mercUser = request.headers.get('X-Merc-User') || request.headers.get('x-merc-user');
      if(mercUser) headers['X-Merc-User'] = mercUser;
    }
  }catch(e){}

  try{
    const resp = await fetch(apiUrl, { method: 'GET', headers });
    const respHeaders = {};
    // Copy selective headers
    resp.headers.forEach((v,k)=>{ respHeaders[k]=v });
    // Add CORS headers
    const outHeaders = Object.assign({}, respHeaders, corsHeaders(request));
    const body = await resp.arrayBuffer();
    return new Response(body, { status: resp.status, headers: outHeaders });
  }catch(err){
    return new Response(JSON.stringify({ error: 'upstream fetch failed', detail: String(err) }), { status: 502, headers: { 'Content-Type':'application/json', ...corsHeaders(request) } });
  }
}
