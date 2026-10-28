import assert from 'node:assert/strict';
import test from 'node:test';
import { rankRecipeProfits } from '../docs/recipe-profit-ranking.mjs';

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
