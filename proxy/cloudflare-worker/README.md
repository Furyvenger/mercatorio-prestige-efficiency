Cloudflare Worker proxy for Mercatorio API

Overview
- This Worker proxies requests from the browser to the Mercatorio API, adds the necessary Authorization header using a secret bound to the Worker, and returns responses with CORS headers so the browser can call it.

Endpoints
- GET /?town=<id>  -> proxies to https://play.mercatorio.io/api/towns/<id>/marketdata
- GET /towns/<id>/marketdata -> same as above

Security
- Store your MERCATORIO_API_TOKEN as a Worker secret (do not embed it in client code).
  Use: wrangler secret put MERCATORIO_API_TOKEN
- Optionally set MERCATORIO_API_USER as a secret or let the client send X-Merc-User header.
- Configure ALLOWED_ORIGIN in the Worker bindings or leave as '*' for testing.

Deploy
1. Install Wrangler: npm install -g wrangler
2. Login: wrangler login
3. Set secrets: wrangler secret put MERCATORIO_API_TOKEN
   (optionally) wrangler secret put MERCATORIO_API_USER
4. Publish: wrangler publish

Client
- Update docs/config.json apiBase to your worker URL, e.g. https://mercatorio-proxy.your-subdomain.workers.dev
- The client can optionally send X-Merc-User header; token comes from the Worker secret.

Caveats
- This proxy consumes your API token; secure your Worker and restrict ALLOWED_ORIGIN.
- For production, restrict allowed origins and apply rate limiting as needed.
