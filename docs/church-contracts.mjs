const CONTRACTS_STORAGE_KEY = 'mercatorio_contracts';

const browserStorage = {
  getItem(key){ return globalThis.localStorage.getItem(key); },
  setItem(key, value){ return globalThis.localStorage.setItem(key, value); },
  removeItem(key){ return globalThis.localStorage.removeItem(key); }
};

function sortResults(results){
  return results.sort((a, b)=>{
    if(a.missing.length && !b.missing.length) return 1;
    if(!a.missing.length && b.missing.length) return -1;
    if(a.costPerPrestige == null && b.costPerPrestige == null) return a.name.localeCompare(b.name);
    if(a.costPerPrestige == null) return 1;
    if(b.costPerPrestige == null) return -1;
    return a.costPerPrestige - b.costPerPrestige;
  });
}

function createContractEntry(contract, markets, getUnitPrice){
  const unitPrice = getUnitPrice(markets, contract.product);
  const totalCost = (unitPrice || 0) * contract.amount;
  const costPerPrestige = contract.prestige > 0 ? totalCost / contract.prestige : null;
  return {
    name: contract.product + ' (contract)',
    prestige: contract.prestige,
    totalCost,
    costPerPrestige,
    missing: unitPrice == null ? [contract.product] : [],
    breakdown: [{ product: contract.product, amount: contract.amount, unitPrice, cost: totalCost }],
    source: 'contract'
  };
}

export function createChurchContracts({ storage = browserStorage, getUnitPrice }){
  function load(){
    try{
      const stored = storage.getItem(CONTRACTS_STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    }catch(e){
      console.warn('Failed to load contracts from localStorage', e);
      return [];
    }
  }

  function save(contracts){
    try{
      storage.setItem(CONTRACTS_STORAGE_KEY, JSON.stringify(contracts));
    }catch(e){
      console.warn('Failed to save contracts to localStorage', e);
    }
  }

  function clearStorage(){
    try{
      storage.removeItem(CONTRACTS_STORAGE_KEY);
    }catch(e){
      console.warn('Failed to clear contracts from localStorage', e);
    }
  }

  return {
    restore(results, markets){
      const contracts = load();
      const restored = results.concat(contracts.map(contract =>
        createContractEntry(contract, markets, getUnitPrice)
      ));
      return { results: sortResults(restored), contracts };
    },

    add(results, marketData, values){
      const product = values.product?.trim();
      const amount = Number(values.amount || 1);
      const prestige = Number(values.prestige || 1);

      if(!product || amount <= 0 || prestige <= 0){
        return { results, status: 'Please fill in product name, amount, and prestige.' };
      }

      if(!results || !marketData){
        return { results, status: 'Please compute prestige first.' };
      }

      const contracts = load();
      if(contracts.some(contract =>
        contract.product === product &&
        contract.amount === amount &&
        contract.prestige === prestige
      )){
        return { results, status: 'This contract already exists in the table.' };
      }

      const markets = marketData.markets || {};
      results.push(createContractEntry({ product, amount, prestige }, markets, getUnitPrice));
      contracts.push({ product, amount, prestige });
      save(contracts);
      return { results: sortResults(results), status: 'Contract added and saved.', added: true };
    },

    clear(results){
      clearStorage();
      return results.filter(result => result.source !== 'contract');
    }
  };
}
