import { createAuthHeaders, loadMarketData } from './market-data.mjs';

function calculateSellProceeds(bids, quantity){
  let remaining = quantity;
  let proceeds = 0;
  const fills = [];
  const sortedBids = bids
    .map(bid => ({ price: Number(bid.price), volume: Number(bid.volume) }))
    .filter(bid => Number.isFinite(bid.price) && bid.price >= 0 && Number.isFinite(bid.volume) && bid.volume > 0)
    .sort((a, b) => b.price - a.price);

  for(const bid of sortedBids){
    if(remaining <= 0) break;
    const amount = Math.min(remaining, bid.volume);
    proceeds += amount * bid.price;
    remaining -= amount;
    fills.push({ amount, price: bid.price, value: amount * bid.price });
  }
  return { proceeds, remaining, fills };
}

export function rankRecipeProfits({ recipes, markets, sellOrders, getUnitPrice }){
  return recipes
    .filter(recipe => Array.isArray(recipe.inputs) && Array.isArray(recipe.outputs) && recipe.outputs.length)
    .map(recipe => {
      let inputCost = 0;
      let outputValue = 0;
      const missing = [];
      const breakdown = [];
      const outputSales = recipe.outputs.map(output => {
        const amount = Number(output.amount || 0);
        if(String(output.product).trim().toLowerCase() === 'money'){
          return { output, amount, ratio: 1 };
        }
        const sale = calculateSellProceeds(sellOrders.get(output.product) || [], amount);
        return {
          output,
          amount,
          ratio: amount > 0 ? Math.min(1, (amount - sale.remaining) / amount) : 1
        };
      });
      const productionRatio = outputSales.reduce((ratio, item) => Math.min(ratio, item.ratio), 1);

      recipe.inputs.forEach(input => {
        const amount = Number(input.amount || 0) * productionRatio;
        const unitPrice = getUnitPrice(markets, input.product);
        if(unitPrice == null) missing.push(input.product);
        const cost = unitPrice == null ? 0 : unitPrice * amount;
        inputCost += cost;
        breakdown.push({ type: 'input', product: input.product, amount, unitPrice, value: cost });
      });
      outputSales.forEach(({ output, amount }) => {
        const sellAmount = amount * productionRatio;
        const scaledSale = String(output.product).trim().toLowerCase() === 'money'
          ? { proceeds: 0, remaining: 0, fills: [] }
          : calculateSellProceeds(sellOrders.get(output.product) || [], sellAmount);
        outputValue += scaledSale.proceeds;
        breakdown.push({ type: 'output', product: output.product, amount: sellAmount, unitPrice: sellAmount ? scaledSale.proceeds / (sellAmount - scaledSale.remaining || 1) : null, value: scaledSale.proceeds, fills: scaledSale.fills, unsold: sellAmount - (sellAmount - scaledSale.remaining) });
      });

      inputCost += 0.5 * productionRatio;
      return {
        name: recipe.name || 'Unnamed recipe',
        profit: outputValue - inputCost,
        inputCost,
        outputValue,
        productionRatio,
        missing: [...new Set(missing)],
        breakdown
      };
    })
    .sort((a, b) => {
      if(a.missing.length && !b.missing.length) return 1;
      if(!a.missing.length && b.missing.length) return -1;
      if(a.missing.length && b.missing.length) return a.name.localeCompare(b.name);
      return b.profit - a.profit;
    });
}

function report(onProgress, message){
  if(onProgress) onProgress(message);
}

export async function fetchRecipeConfiguration({
  apiBase,
  token,
  user,
  fetchImpl = fetch
}){
  const response = await fetchImpl(`${apiBase}/config/recipes`, {
    headers: createAuthHeaders(token, user, true),
    cache: 'no-store'
  });
  if(!response.ok) throw new Error('HTTP '+response.status);
  const recipesObject = await response.json();
  const recipeData = Array.isArray(recipesObject)
    ? recipesObject
    : (recipesObject.recipes || recipesObject);
  return Object.values(recipeData)
    .filter(recipe => recipe && typeof recipe === 'object');
}

export async function fetchRecipeProfits({
  townId,
  apiBase,
  token,
  user,
  getUnitPrice,
  fetchImpl = fetch,
  onProgress,
  onMarketData,
  pageUrl = ''
}){
  townId = String(townId || '').trim();
  const marketData = await loadMarketData({
    townId,
    apiBase,
    token,
    user,
    fetchImpl,
    onProgress,
    onMarketData,
    pageUrl
  });

  if(!marketData) return null;

  const recipes = await fetchRecipeConfiguration({
    apiBase,
    token,
    user,
    fetchImpl
  });

  const markets = marketData.markets || {};
  const outputProducts = [...new Set(recipes
    .filter(recipe => Array.isArray(recipe.inputs) && Array.isArray(recipe.outputs) && recipe.outputs.length)
    .flatMap(recipe => recipe.outputs.map(output => output.product))
    .filter(product => String(product).trim().toLowerCase() !== 'money'))];
  const sellOrders = new Map();
  const failedProducts = [];
  await Promise.all(outputProducts.map(async product => {
    try{
      const url = `${apiBase}/towns/${encodeURIComponent(townId)}/markets/${encodeURIComponent(product)}`;
      const response = await fetchImpl(url, {
        headers: createAuthHeaders(token, user, true),
        cache: 'no-store'
      });
      if(!response.ok) throw new Error(`${product}: HTTP ${response.status}`);
      const market = await response.json();
      sellOrders.set(product, Array.isArray(market.bids) ? market.bids : []);
    }catch(error){
      console.warn('Failed to load buy orders for '+product, error);
      sellOrders.set(product, []);
      failedProducts.push(product);
    }
  }));

  return {
    profits: rankRecipeProfits({ recipes, markets, sellOrders, getUnitPrice }),
    failedProducts
  };
}
