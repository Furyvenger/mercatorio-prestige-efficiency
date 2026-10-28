import assert from 'node:assert/strict';
import test from 'node:test';
import {
  fetchRecipeProfits,
  rankRecipeProfits
} from '../docs/recipe-profit-ranking.mjs';

const getUnitPrice = (markets, product) => markets[product] ?? null;

test('ranks recipes by sellable output proceeds minus scaled input and operating costs', ()=>{
  const recipes = [
    {
      name: 'Two outputs',
      inputs: [{ product: 'ore', amount: 4 }],
      outputs: [{ product: 'bar', amount: 4 }, { product: 'dust', amount: 2 }]
    },
    {
      name: 'One output',
      inputs: [{ product: 'ore', amount: 2 }],
      outputs: [{ product: 'bar', amount: 2 }]
    }
  ];

  const ranked = rankRecipeProfits({
    recipes,
    markets: { ore: 3 },
    sellOrders: new Map([
      ['bar', [{ price: 10, volume: 2 }, { price: 8, volume: 2 }]],
      ['dust', [{ price: 5, volume: 1 }]]
    ]),
    getUnitPrice
  });

  assert.deepEqual(ranked.map(recipe => recipe.name), ['Two outputs', 'One output']);
  const twoOutputs = ranked[0];
  assert.equal(twoOutputs.productionRatio, 0.5);
  assert.equal(twoOutputs.inputCost, 6.25);
  assert.equal(twoOutputs.outputValue, 25);
  assert.equal(twoOutputs.profit, 18.75);
  assert.deepEqual(twoOutputs.breakdown[1].fills, [
    { amount: 2, price: 10, value: 20 }
  ]);
  assert.deepEqual(twoOutputs.breakdown[2].fills, [
    { amount: 1, price: 5, value: 5 }
  ]);
});

test('sorts missing input prices last and keeps their names alphabetical', ()=>{
  const ranked = rankRecipeProfits({
    recipes: [
      { name: 'Z missing', inputs: [{ product: 'unknown-z', amount: 1 }], outputs: [{ product: 'money', amount: 10 }] },
      { name: 'Priced', inputs: [{ product: 'ore', amount: 1 }], outputs: [{ product: 'money', amount: 10 }] },
      { name: 'A missing', inputs: [{ product: 'unknown-a', amount: 1 }], outputs: [{ product: 'money', amount: 10 }] }
    ],
    markets: { ore: 2 },
    sellOrders: new Map(),
    getUnitPrice
  });

  assert.deepEqual(ranked.map(recipe => recipe.name), ['Priced', 'A missing', 'Z missing']);
  assert.deepEqual(ranked[1].missing, ['unknown-a']);
  assert.equal(ranked[1].profit, -0.5);
});

test('ignores recipes without valid inputs and outputs', ()=>{
  const ranked = rankRecipeProfits({
    recipes: [
      { name: 'No inputs', outputs: [{ product: 'bar', amount: 1 }] },
      { name: 'No outputs', inputs: [{ product: 'ore', amount: 1 }], outputs: [] },
      { name: 'Valid', inputs: [], outputs: [{ product: 'money', amount: 1 }] }
    ],
    markets: {},
    sellOrders: new Map(),
    getUnitPrice
  });

  assert.deepEqual(ranked.map(recipe => recipe.name), ['Valid']);
});

test('fetches recipe-profit inputs and ranks them through the workflow', async ()=>{
  const calls = [];
  const statuses = [];
  let observedMarketData;
  const responses = [
    { ok: true, json: async () => ({ markets: { ore: { last_price: 3, volume: 1 } } }) },
    { ok: true, json: async () => ({ recipes: [{
      name: 'Bar recipe',
      inputs: [{ product: 'ore', amount: 1 }],
      outputs: [{ product: 'bar', amount: 2 }]
    }] }) },
    { ok: true, json: async () => ({ bids: [{ price: 10, volume: 2 }] }) }
  ];

  const result = await fetchRecipeProfits({
    townId: 'town 1',
    apiBase: 'https://market.example/api',
    token: 'secret-token',
    user: 'trader@example.test',
    getUnitPrice: (markets, product) => markets[product]?.last_price ?? null,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return responses[calls.length - 1];
    },
    onProgress: message => statuses.push(message),
    onMarketData: data => { observedMarketData = data; },
    pageUrl: 'https://app.example/'
  });

  assert.deepEqual(calls.map(call => call.url), [
    'https://market.example/api/towns/town%201/marketdata',
    'https://market.example/api/config/recipes',
    'https://market.example/api/towns/town%201/markets/bar'
  ]);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer secret-token');
  assert.equal(calls[0].options.headers['X-Merc-User'], 'trader@example.test');
  assert.equal(calls[1].options.cache, 'no-store');
  assert.equal(calls[2].options.cache, 'no-store');
  assert.deepEqual(observedMarketData, { markets: { ore: { last_price: 3, volume: 1 } } });
  assert.deepEqual(statuses, ['Fetching market data...', 'Loaded (direct).']);
  assert.deepEqual(result.failedProducts, []);
  assert.equal(result.profits[0].profit, 16.5);
});

test('falls back to the public proxy for non-network market errors', async ()=>{
  const calls = [];
  const statuses = [];
  const result = await fetchRecipeProfits({
    townId: 'town-1',
    apiBase: 'https://market.example/api',
    getUnitPrice,
    fetchImpl: async url => {
      calls.push(url);
      if(calls.length === 1) return { ok: false, status: 503 };
      if(calls.length === 2) {
        return {
          ok: true,
          text: async () => JSON.stringify({ markets: {} })
        };
      }
      if(calls.length === 3) return { ok: true, json: async () => [] };
      throw new Error('unexpected request');
    },
    onProgress: message => statuses.push(message)
  });

  assert.equal(calls[0], 'https://market.example/api/towns/town-1/marketdata');
  assert.match(calls[1], /^https:\/\/api\.allorigins\.win\/raw\?url=/);
  assert.deepEqual(statuses, [
    'Fetching market data...',
    'Direct fetch failed; trying CORS proxy...',
    'Loaded (via proxy).'
  ]);
  assert.deepEqual(result.profits, []);
});

test('stops after direct network errors and reports the CORS instructions', async ()=>{
  const calls = [];
  const statuses = [];
  const result = await fetchRecipeProfits({
    townId: 'town-1',
    apiBase: 'https://market.example/api',
    getUnitPrice,
    fetchImpl: async url => {
      calls.push(url);
      throw new TypeError('Failed to fetch');
    },
    onProgress: message => statuses.push(message),
    pageUrl: 'https://app.example/path'
  });

  assert.equal(result, null);
  assert.equal(calls.length, 1);
  assert.match(statuses[1], /Network\/CORS error/);
  assert.match(statuses[1], /https:\/\/app\.example\/path\?token=/);
});

test('returns no result for an empty town or empty market response', async ()=>{
  const statuses = [];
  let fetchCalls = 0;
  const options = {
    apiBase: 'https://market.example/api',
    getUnitPrice,
    fetchImpl: async () => {
      fetchCalls++;
      return { ok: true, json: async () => null };
    },
    onProgress: message => statuses.push(message)
  };

  assert.equal(await fetchRecipeProfits({ ...options, townId: '  ' }), null);
  assert.equal(await fetchRecipeProfits({ ...options, townId: 'town-1' }), null);
  assert.equal(fetchCalls, 1);
  assert.deepEqual(statuses, [
    'Enter a town ID to load market data.',
    'Fetching market data...',
    'Loaded (direct).'
  ]);
});

test('marks failed sell-order requests and continues ranking', async ()=>{
  const responses = [
    { ok: true, json: async () => ({ markets: { ore: 3 } }) },
    { ok: true, json: async () => [{ name: 'Bar', inputs: [{ product: 'ore', amount: 1 }], outputs: [{ product: 'bar', amount: 2 }] }] },
    { ok: false, status: 500 }
  ];
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args);
  try{
    const result = await fetchRecipeProfits({
      townId: 'town-1',
      apiBase: 'https://market.example/api',
      getUnitPrice,
      fetchImpl: async () => responses.shift()
    });

    assert.deepEqual(result.failedProducts, ['bar']);
    assert.equal(result.profits.length, 1);
    assert.equal(result.profits[0].outputValue, 0);
    assert.equal(warnings.length, 1);
  }finally{
    console.warn = originalWarn;
  }
});

test('propagates recipe configuration errors to the caller', async ()=>{
  const responses = [
    { ok: true, json: async () => ({ markets: {} }) },
    { ok: false, status: 401 }
  ];
  await assert.rejects(() => fetchRecipeProfits({
    townId: 'town-1',
    apiBase: 'https://market.example/api',
    getUnitPrice,
    fetchImpl: async () => responses.shift()
  }), { message: 'HTTP 401' });
});
