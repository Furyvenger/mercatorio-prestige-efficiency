# Copilot Instructions for mercatorio-prestige-efficiency

## Project Overview

**Mercatorio Prestige Efficiency** is a GitHub Pages web app that calculates the most cost-efficient prestige farming methods in the game Mercatorio. It fetches market data from `play.mercatorio.io`, combines it with recipe/household/building data, and computes cost-per-prestige rankings.

The app is **frontend-only** (static JavaScript + HTML) deployed via GitHub Pages, with optional Cloudflare Worker proxy and GitHub Actions for automated market data caching.

## Architecture

### Frontend (docs/)
- **app.js**: Main logic for market data fetching and prestige efficiency computation
  - `fetchMarketData()`: Attempts cache → direct fetch → CORS proxy → mock data fallback
  - `computePrestigeCosts()`: Loads recipes/household/buildings, fetches market prices, calculates cost/prestige rankings
  - `renderPrestigeResults()`: Displays results in HTML table with detail expansion
- **index.html**: Simple UI for town ID input, credentials, and prestige results
- **config.json**: API base URL and town IDs for caching
- **Data files**:
  - `recipes_season_7.json`: Recipe outputs/prestige/site
  - `household.json`: Household consumption products/prestige
  - `buildings.json`: Building construction materials/prestige
  - `cache/town_*.json`: Cached market data (populated by GitHub Actions)

### GitHub Actions (.github/workflows/fetch_marketdata.yml)
- **Trigger**: Hourly schedule + manual workflow dispatch
- **Workflow**:
  1. Reads town IDs from `docs/config.json`
  2. Fetches market data via `play.mercatorio.io/api/towns/<id>/marketdata`
  3. Uses secrets: `MERCATORIO_API_TOKEN`, `MERCATORIO_API_USER`
  4. Wraps cache with `fetched_at` timestamp via `wrap_cache.py`
  5. Commits cache to `docs/cache/town_*.json`

### Cloudflare Worker (proxy/cloudflare-worker/)
- **Purpose**: Proxies API requests from browser to Mercatorio API, adding auth headers and CORS headers
- **Deploy**: `wrangler publish` (requires `wrangler` CLI)
- **Config**: `wrangler.toml`
- **Secrets**: `MERCATORIO_API_TOKEN`, optionally `MERCATORIO_API_USER`

## Key Conventions & Data Structures

### Market Data Structure
```javascript
{
  "markets": {
    "<product>": {
      "highest_bid": <number>,
      "last_price": <number>,      // preferred for pricing
      "lowest_ask": <number>,
      "volume": <number>
    }
  },
  "fetched_at": "2024-01-01T12:00:00Z"  // added by wrap_cache.py
}
```

### Prestige Entry Structure (recipes/household/buildings)
```javascript
{
  "name": "Recipe Name",
  "prestige": <number>,           // raw prestige value
  "inputs": [
    { "product": "item_name", "amount": <number> },
    ...
  ],
  "source": "recipe|household|building",  // for UI highlighting
  ...
}
```

### Prestige Calculation
- **Recipe prestige**: Raw prestige × 100
- **Household prestige**: Raw prestige × 1 (no multiplier)
- **Building prestige**: Raw prestige × 100
- **Apprentice boost**: Household consumption increases by 25% per apprentice (excludes "gear" and "luxury" categories)
- **Recipe tax**: +0.5 (or +6 if site requires center)
- **Final metric**: `cost_per_prestige = total_cost / prestige`

### Data Source Loading Strategy
For each data type (recipes, household, buildings), the app tries multiple sources in order:
1. Local file relative to served docs root (e.g., `recipes_season_7.json`)
2. GitHub raw URL fallback (e.g., `https://raw.githubusercontent.com/Furyvenger/mercatorio-prestige-efficiency/main/recipes_season_7.json`)

Household/buildings JSON parsing is lenient: attempts strict JSON first, then regex-normalizes JS object literals (quote unquoted keys, convert single quotes).

### Market Data Fetch Fallback
1. **Cache first** (if no credentials OR user requests cache)
2. **Direct authenticated fetch** (if credentials provided)
3. **CORS proxy** (public `api.allorigins.win` proxy as fallback)
4. **Mock data** (local `sample_marketdata.json` for dev/demo)

## Configuration

### docs/config.json
```json
{
  "apiBase": "https://your-proxy-url.workers.dev",
  "defaultTownId": "78000248",
  "towns": ["78000248", "..."]  // town IDs for GitHub Actions caching
}
```

### GitHub Secrets (for Actions & Cloudflare Worker)
- `MERCATORIO_API_TOKEN`: Bearer token for Mercatorio API
- `MERCATORIO_API_USER`: Email/username for X-Merc-User header

## Deployment

### GitHub Pages
- Auto-deployed on commits to `main` (docs folder)
- No build step required

### GitHub Actions Setup
1. Add repository secrets (see DEPLOY.md)
2. Workflow runs hourly; trigger manual run via Actions tab
3. Cached data populates `docs/cache/town_*.json`
4. UI shows "Cached: <timestamp>" when using cached data

### Cloudflare Worker Deployment
1. `npm install -g wrangler` (or use existing system wrangler)
2. `cd proxy/cloudflare-worker`
3. `wrangler login`
4. `wrangler secret put MERCATORIO_API_TOKEN` (paste token)
5. `wrangler secret put MERCATORIO_API_USER` (optional, paste email)
6. `wrangler publish`
7. Update `docs/config.json` `apiBase` to worker URL

## Testing & Debugging

### Local Testing
- Open `docs/index.html` in browser (or serve with `python -m http.server 8000`)
- Use cached data checkbox to test without credentials
- Paste token/email in UI to test direct fetch (insecure for production)
- URL parameters: `?token=<TOKEN>&user=<EMAIL>&save=1` to auto-fill & save credentials

### Market Data Debug
- Check browser DevTools Network tab for fetch failures
- If CORS blocks: verify Cloudflare Worker is deployed, or disable cache to use proxy fallback
- Verify `docs/cache/town_*.json` has real data from latest GitHub Action run

### Recipe/Household/Building Data Debug
- Ensure JSON files exist at expected paths and are valid JSON
- Use browser DevTools console to check `fetch()` responses for parse errors
- Test with mock data (`sample_marketdata.json`) if production API is unavailable

## Common Edits

### Adding a new town to caching
1. Add town ID to `docs/config.json` `towns` array
2. Trigger workflow manually or wait for next hourly run
3. Cache will populate as `docs/cache/town_<id>.json`

### Updating recipes/household/buildings data
1. Edit respective JSON file in `docs/`
2. Ensure valid JSON structure (or lenient parser will attempt recovery)
3. Commit; GitHub Pages auto-deploys

### Changing prestige multiplier logic
- Edit `computePrestigeCosts()` in `docs/app.js` (search for `prestige = prestige * 100`)
- Rebuild UI rendering logic if output structure changes

### Debugging a specific entry
- Use `renderPrestigeResults()` details button to expand cost breakdown
- Breakdown shows per-product unit price × amount = cost

## External Dependencies

### APIs
- **Mercatorio API**: `https://play.mercatorio.io/api/towns/<id>/marketdata` (requires auth)

### Tools
- **Cloudflare Wrangler** (optional, only if deploying Worker proxy)
- **Python 3** (for GitHub Actions workflow: `wrap_cache.py`)
- **GitHub Secrets** (for Actions credentials)

No npm/pip packages required for the frontend itself.

## Security Notes

- **Secrets**: Store API tokens in GitHub Secrets only; never commit to repo
- **CORS proxy fallback**: `api.allorigins.win` is public; only use for testing
- **Client-side token**: URL params and localStorage are visible to browser; only use in testing
- **Cloudflare Worker**: Secure the Worker URL and configure `ALLOWED_ORIGIN` for production
