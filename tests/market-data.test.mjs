import assert from 'node:assert/strict';
import test from 'node:test';
import { loadMarketData } from '../docs/market-data.mjs';

test('loads direct market data with credentials and reports it before completion', async ()=>{
  const calls = [];
  const events = [];
  const marketData = { markets: { ore: { last_price: 3 } } };

  const result = await loadMarketData({
    townId: 'town 1',
    apiBase: 'https://market.example/api',
    token: ' secret-token ',
    user: ' trader@example.test ',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, json: async () => marketData };
    },
    onMarketData: data => events.push(['data', data]),
    onProgress: message => events.push(['status', message])
  });

  assert.equal(result, marketData);
  assert.deepEqual(calls, [{
    url: 'https://market.example/api/towns/town%201/marketdata',
    options: {
      headers: {
        Authorization: 'Bearer secret-token',
        'X-Merc-User': 'trader@example.test'
      }
    }
  }]);
  assert.deepEqual(events, [
    ['status', 'Fetching market data...'],
    ['data', marketData],
    ['status', 'Loaded (direct).']
  ]);
});

test('uses the public proxy after a non-network direct failure', async ()=>{
  const calls = [];
  const statuses = [];
  const marketData = { markets: { grain: {} } };

  const result = await loadMarketData({
    townId: 'town-1',
    apiBase: 'https://market.example/api',
    fetchImpl: async url => {
      calls.push(url);
      if(calls.length === 1) return { ok: false, status: 503 };
      return { ok: true, text: async () => JSON.stringify(marketData) };
    },
    onProgress: message => statuses.push(message)
  });

  assert.equal(calls[0], 'https://market.example/api/towns/town-1/marketdata');
  assert.match(calls[1], /^https:\/\/api\.allorigins\.win\/raw\?url=/);
  assert.deepEqual(result, marketData);
  assert.deepEqual(statuses, [
    'Fetching market data...',
    'Direct fetch failed; trying CORS proxy...',
    'Loaded (via proxy).'
  ]);
});

test('does not retry the proxy after a direct network error', async ()=>{
  const calls = [];
  const statuses = [];

  const result = await loadMarketData({
    townId: 'town-1',
    apiBase: 'https://market.example/api',
    pageUrl: 'https://app.example/path',
    fetchImpl: async url => {
      calls.push(url);
      throw new TypeError('Failed to fetch');
    },
    onProgress: message => statuses.push(message)
  });

  assert.equal(result, null);
  assert.equal(calls.length, 1);
  assert.match(statuses[1], /Network\/CORS error/);
  assert.match(statuses[1], /https:\/\/app\.example\/path\?token=/);
});
