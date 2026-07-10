# Mercatorio API documentation (experimental and incomplete!)

Protocol: https
Host: play.mercatorio.io

# Public endpoints

## Town markets overview
```
GET /api/towns/<town_id>/marketdata
```

Response:
```
{
  "markets": {
    <product>: {
      "highest_bid": <highest pending bid>,
      "last_price": <last trade price>,
      "lowest_ask": <lowest pending ask>,
      "volume": <current turn volume>
    },
    ...
  }
}
```


## Market state
```
GET /api/towns/<town_id>/markets/<product>
```

Response:
```
{
  "bids": [
    {
      "price": <price>,
      "volume": <volume>
    },
    ...
  ],
  "asks": [
    {
      "price": <price>,
      "volume": <volume>
    },
    ...
  ],
  "data": {
    "highest_bid": <highest pending bid>,
    "last_price": <last trade price>,
    "lowest_ask": <lowest pending ask>,
    "volume": <current turn volume>
  }
}
```

# Private endpoints

## Building data
```
GET /api/buildings/<building_id>
```

Response (warehouse example):
```
{
    "name": <name>,
    "type": <building type>,
    "owner_id": <business owning building>,
    "storage": {
        "reference": <reference used for manual trading>,
        "inventory": {
            "account": {
                "id": <account_id>,
                "assets": {
                    <product>: {
                        "balance": <total holding>,
                        "reserved": <reserved for sale>,
                        "capacity": <storage capacity in units>,
                        "reserved_capacity": <reserved for purchases>,
                        "purchase": <units purchased this turn>,
                        "purchase_price": <average price paid for purchases>,
                        "sale": <units sold this turn>,
                        "sale_price": <average price fetched for sales>,
                        "unit_cost": <average price of all holdings>
                    },
                    ...
                }
            },
            "holdings": {
                <product>: {
                    "managers": [
                        {
                            "min_holding": <low stock>,
                            "max_holding": <high stock>,
                            "buy_volume": <volume to buy each turn>,
                            "buy_price": <max price to offer>,
                            "sell_volume": <volume to sell each turn>,
                            "sell_price": <min price to accept>
                        }
                    ]
                },
                ...
            }
        }
    }
}
```

## Updating automatic trade settings

```
PATCH api/buildings/<building_id>/storage/inventory/<product>
```

Request:
```
{
    "managers": [
        {
            "min_holding": <low stock>,
            "max_holding": <high stock>,
            "buy_volume": <volume to buy each turn>,
            "buy_price": <max price to offer>,
            "sell_volume": <volume to sell each turn>,
            "sell_price": <min price to accept>
        }
    ]
}
```

## Posting manual orders
```
POST /towns/<town_id>/markets/<product>/orders
```

Request:
```
{
    "operation": <operation or building reference>,
    "direction": <`bid` or `ask`>,
    "volume": <product amount>,
    "price": <price per unit>
}
```
