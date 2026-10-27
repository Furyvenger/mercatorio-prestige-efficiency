import assert from 'node:assert/strict';
import test from 'node:test';
import { createChurchContracts } from '../docs/church-contracts.mjs';

const STORAGE_KEY = 'mercatorio_contracts';

function createStorage(initial = null){
  const values = new Map(initial == null ? [] : [[STORAGE_KEY, JSON.stringify(initial)]]);
  return {
    getItem(key){ return values.get(key) ?? null; },
    setItem(key, value){ values.set(key, value); },
    removeItem(key){ values.delete(key); },
    readContracts(){ return JSON.parse(values.get(STORAGE_KEY) || '[]'); },
    hasContracts(){ return values.has(STORAGE_KEY); }
  };
}

function getUnitPrice(markets, product){
  return markets[product] ?? null;
}

test('restores the global saved list using current market prices and sorts all results', ()=>{
  const storage = createStorage([
    { product: 'Apple', amount: 4, prestige: 2 },
    { product: 'Missing item', amount: 3, prestige: 1 }
  ]);
  const lifecycle = createChurchContracts({ storage, getUnitPrice });
  const baseResults = [
    { name: 'Recipe', source: 'recipe', missing: [], costPerPrestige: 3 },
    { name: 'Unpriced recipe', source: 'recipe', missing: ['Unknown'], costPerPrestige: null }
  ];

  const restored = lifecycle.restore(baseResults, { Apple: 2 });

  assert.deepEqual(restored.contracts, storage.readContracts());
  assert.deepEqual(restored.results.map(result => result.name), [
    'Recipe',
    'Apple (contract)',
    'Missing item (contract)',
    'Unpriced recipe'
  ]);
  const apple = restored.results[1];
  assert.equal(apple.totalCost, 8);
  assert.equal(apple.costPerPrestige, 4);
  assert.deepEqual(apple.breakdown[0], {
    product: 'Apple',
    amount: 4,
    unitPrice: 2,
    cost: 8
  });
  const missing = restored.results.find(result => result.name === 'Missing item (contract)');
  assert.deepEqual(missing.missing, ['Missing item']);
  assert.equal(missing.costPerPrestige, 0);
});

test('adds and persists contracts in the legacy shape, recalculating cost from current markets', ()=>{
  const storage = createStorage();
  const lifecycle = createChurchContracts({ storage, getUnitPrice });
  const results = [{ name: 'Recipe', source: 'recipe', missing: [], costPerPrestige: 5 }];

  const added = lifecycle.add(results, { markets: { Apple: 2 } }, {
    product: ' Apple ',
    amount: '4',
    prestige: '2'
  });

  assert.equal(added.status, 'Contract added and saved.');
  assert.equal(added.added, true);
  assert.deepEqual(storage.readContracts(), [{ product: 'Apple', amount: 4, prestige: 2 }]);
  assert.equal(added.results[0].name, 'Apple (contract)');
  assert.equal(added.results[0].totalCost, 8);
  assert.equal(added.results[0].costPerPrestige, 4);

  const duplicate = lifecycle.add(added.results, { markets: { Apple: 1 } }, {
    product: 'Apple',
    amount: '4',
    prestige: '2'
  });
  assert.equal(duplicate.status, 'This contract already exists in the table.');
  assert.equal(duplicate.added, undefined);
  assert.equal(duplicate.results.length, 2);
  assert.deepEqual(storage.readContracts(), [{ product: 'Apple', amount: 4, prestige: 2 }]);
});

test('preserves default values, validation, and the compute-before-add requirement', ()=>{
  const storage = createStorage();
  const lifecycle = createChurchContracts({ storage, getUnitPrice });
  const initialResults = [];

  assert.equal(lifecycle.add(initialResults, null, {
    product: '',
    amount: '1',
    prestige: '1'
  }).status, 'Please fill in product name, amount, and prestige.');
  assert.equal(lifecycle.add(initialResults, null, {
    product: 'Apple',
    amount: '0',
    prestige: '1'
  }).status, 'Please fill in product name, amount, and prestige.');
  assert.equal(lifecycle.add(initialResults, null, {
    product: 'Apple',
    amount: '1',
    prestige: '1'
  }).status, 'Please compute prestige first.');

  const added = lifecycle.add(initialResults, { markets: {} }, {
    product: 'Apple',
    amount: '',
    prestige: ''
  });
  assert.deepEqual(storage.readContracts(), [{ product: 'Apple', amount: 1, prestige: 1 }]);
  assert.deepEqual(added.results[0].missing, ['Apple']);
});

test('clears persisted contracts and removes only contract ranking rows', ()=>{
  const storage = createStorage([{ product: 'Apple', amount: 1, prestige: 1 }]);
  const lifecycle = createChurchContracts({ storage, getUnitPrice });
  const results = [
    { name: 'Recipe', source: 'recipe' },
    { name: 'Household', source: 'household' },
    { name: 'Church donation', source: 'contract' }
  ];

  const cleared = lifecycle.clear(results);

  assert.equal(storage.hasContracts(), false);
  assert.deepEqual(cleared, results.slice(0, 2));
  assert.deepEqual(results.map(result => result.name), ['Recipe', 'Household', 'Church donation']);
});
