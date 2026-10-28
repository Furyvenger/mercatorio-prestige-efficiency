function normalizeHouseholdEntries(household, apprentices){
  const factor = 1 + 0.20 * Math.max(0, Number(apprentices));
  return household.map(item => {
    let amount = Number(item.volume || 0);
    if(!item.category || !['gear', 'luxury'].includes(item.category)){
      amount *= factor;
    }
    return {
      name: (item.product || 'household') + (item.category ? ` (${item.category})` : ' (household)'),
      inputs: [{ product: item.product, amount }],
      prestige: Number(item.prestige || 0),
      source: 'household',
      category: item.category || null,
      raw: item
    };
  });
}

function normalizeBuildingEntries(buildings){
  return buildings
    .filter(building => building.prestige && Number(building.prestige) !== 0)
    .map(building => {
      const materials = building.materials || (building.construction && building.construction.materials) || {};
      let inputs = [];
      if(Array.isArray(materials)){
        inputs = materials.map(material => ({
          product: material.product,
          amount: Number(material.amount || 0)
        }));
      }else if(materials && typeof materials === 'object'){
        inputs = Object.keys(materials).map(product => ({
          product,
          amount: Number(materials[product] || 0)
        }));
      }
      return {
        name: building.type || building.name || 'building',
        inputs,
        prestige: Number(building.prestige || 0) * 100,
        source: 'building',
        raw: building
      };
    });
}

export function calculatePrestigeEfficiency({
  recipes,
  household = [],
  buildings = [],
  markets,
  apprentices = 0,
  getUnitPrice
}){
  // Recipe prestige from the API is already in actual prestige units.
  const recipeEntries = recipes
    .filter(recipe => recipe.prestige && Number(recipe.prestige) !== 0)
    .map(recipe => Object.assign({ source: 'recipe' }, recipe));
  const householdEntries = normalizeHouseholdEntries(household, apprentices);
  const buildingEntries = normalizeBuildingEntries(buildings);
  const allEntries = [...recipeEntries, ...householdEntries, ...buildingEntries];

  return allEntries.map(entry => {
    const inputs = entry.inputs || [];
    let totalCost = 0;
    const missing = [];
    const breakdown = [];
    for(const input of inputs){
      const amount = Number(input.amount || 0);
      const product = input.product;
      const unitPrice = getUnitPrice(markets, product);
      if(unitPrice == null) missing.push(product);
      const cost = unitPrice == null ? 0 : unitPrice * amount;
      breakdown.push({ product, amount, unitPrice, cost });
      totalCost += cost;
    }

    const prestige = Number(entry.prestige || 0);
    if(entry.source === 'recipe'){
      const site = entry.site || (entry.recipe && entry.recipe.site) || null;
      const building = site && buildings.find(item => item.type === site);
      totalCost += building && building.requires && building.requires.center === true ? 6 : 0.5;
    }

    return {
      name: entry.name || entry.product || '',
      prestige,
      totalCost,
      costPerPrestige: missing.length === 0 && prestige > 0 ? totalCost / prestige : null,
      missing,
      breakdown,
      recipe: entry,
      source: entry.source || 'recipe'
    };
  });
}
