Deployment and secret setup

1) Add repository secrets
- In GitHub: Settings → Secrets and variables → Actions → New repository secret
- Add: MERCATORIO_API_TOKEN = <your API token>
- Add: MERCATORIO_API_USER = <your merc user email>

2) Trigger workflow
- In GitHub: Actions → Fetch Mercatorio Market Data → Run workflow (choose branch/main)
- The workflow will populate docs/cache/town_<id>.json with a fetched_at timestamp.

3) Verify and publish
- After workflow success, confirm docs/cache/town_1.json contains real data and "fetched_at".
- Reload the Pages site; UI shows "Cached: <timestamp>" when using cache.

4) Local testing options
- To test locally with your token (unsafe to paste publicly), open:
  https://<your-gh-pages-url>/?token=<token>&user=<email>&save=1
- Or in the browser DevTools console run:
  fetch('https://play.mercatorio.io/api/towns/1/marketdata', { headers: { 'Authorization': 'Bearer 85ad56d...', 'X-Merc-User':'you@example.com' } }).then(r=>r.json()).then(console.log)

Security
- Do NOT commit tokens to the repo. Use GitHub Secrets. The Action will use secrets to fetch and commit only the cached JSON.

If you want, I can commit this file and create a commit (will not push).