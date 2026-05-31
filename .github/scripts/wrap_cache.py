import json
import datetime
import sys

if len(sys.argv) < 2:
    sys.exit(0)

id = sys.argv[1]
path = f"docs/cache/town_{id}.json"
try:
    with open(path, 'r') as f:
        data = json.load(f)
    if isinstance(data, dict) and 'markets' in data:
        out = {'fetched_at': datetime.datetime.utcnow().isoformat() + 'Z', **data}
    else:
        out = {'fetched_at': datetime.datetime.utcnow().isoformat() + 'Z', 'markets': data}
except Exception:
    out = {'fetched_at': datetime.datetime.utcnow().isoformat() + 'Z', 'markets': {}}
with open(path, 'w') as f:
    json.dump(out, f)
