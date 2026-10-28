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
