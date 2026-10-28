import assert from 'node:assert/strict';
import test from 'node:test';
import { calculatePrestigeEfficiency } from '../docs/prestige-efficiency.mjs';

function getUnitPrice(markets, product){
  return markets[product] ?? null;
}

test('calculates recipe cost with actual prestige and the site tax', ()=>{
  const results = calculatePrestigeEfficiency({
    recipes: [
      { name: 'Town recipe', prestige: 10, site: 'Workshop', inputs: [{ product: 'Wood', amount: 2 }] },
      { name: 'Center recipe', prestige: 5, site: 'Hall', inputs: [] },
      { name: 'No prestige', prestige: 0, inputs: [] }
    ],
    buildings: [{ type: 'Hall', requires: { center: true } }],
    markets: { Wood: 3 },
    getUnitPrice
  });

  assert.equal(results.length, 2);
  assert.deepEqual(results[0], {
    name: 'Town recipe',
    prestige: 10,
    totalCost: 6.5,
    costPerPrestige: 0.65,
    missing: [],
    breakdown: [{ product: 'Wood', amount: 2, unitPrice: 3, cost: 6 }],
    recipe: {
      source: 'recipe',
      name: 'Town recipe',
      prestige: 10,
      site: 'Workshop',
      inputs: [{ product: 'Wood', amount: 2 }]
    },
    source: 'recipe'
  });
  assert.equal(results[1].totalCost, 6);
  assert.equal(results[1].costPerPrestige, 1.2);
});

test('scales household consumption for apprentices except gear and luxury', ()=>{
  const results = calculatePrestigeEfficiency({
    recipes: [],
    household: [
      { product: 'Food', volume: 5, prestige: 2 },
      { product: 'Tools', volume: 4, prestige: 1, category: 'gear' },
      { product: 'Wine', volume: 3, prestige: 1, category: 'luxury' }
    ],
    markets: { Food: 2, Tools: 3, Wine: 4 },
    apprentices: 2,
    getUnitPrice
  });

  assert.deepEqual(results.map(result => result.breakdown[0].amount), [7, 4, 3]);
  assert.deepEqual(results.map(result => result.costPerPrestige), [7, 12, 12]);
  assert.deepEqual(results.map(result => result.source), ['household', 'household', 'household']);
});

test('normalizes building materials and applies the building prestige multiplier', ()=>{
  const results = calculatePrestigeEfficiency({
    recipes: [],
    buildings: [
      { type: 'Workshop', prestige: 3, materials: { Wood: 2, Stone: 1 } },
      { name: 'Bridge', prestige: 2, construction: { materials: [{ product: 'Stone', amount: 4 }] } }
    ],
    markets: { Wood: 2, Stone: 5 },
    getUnitPrice
  });

  assert.equal(results[0].prestige, 300);
  assert.equal(results[0].totalCost, 9);
  assert.equal(results[0].costPerPrestige, 0.03);
  assert.equal(results[1].name, 'Bridge');
  assert.equal(results[1].prestige, 200);
  assert.equal(results[1].totalCost, 20);
});

test('leaves cost per prestige unavailable when any required price is missing', ()=>{
  const results = calculatePrestigeEfficiency({
    recipes: [{
      name: 'Unpriced recipe',
      prestige: 4,
      inputs: [{ product: 'Unknown', amount: 3 }]
    }],
    markets: {},
    getUnitPrice
  });

  assert.equal(results[0].totalCost, 0.5);
  assert.deepEqual(results[0].missing, ['Unknown']);
  assert.equal(results[0].costPerPrestige, null);
});
