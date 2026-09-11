Cloudflare Worker proxy for Mercatorio API

Overview
- This Worker proxies requests from the browser to the Mercatorio API, adds the necessary Authorization header using a secret bound to the Worker, and returns responses with CORS headers so the browser can call it.

Endpoints
- Any GET or HEAD API path is forwarded to the fixed Mercatorio API base:
  `https://mercatorio-proxy.example.workers.dev/<path>` ->
  `https://play.mercatorio.io/api/<path>`
- For example, `GET /config/recipes` forwards to
  `https://play.mercatorio.io/api/config/recipes`.
- Query strings are forwarded unchanged, and an optional `/api` prefix is accepted.

This means new read-only API endpoints do not require a worker code change. The
worker still owns the upstream host, so callers cannot redirect it to another
domain.

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
