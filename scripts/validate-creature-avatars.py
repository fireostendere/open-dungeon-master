#!/usr/bin/env python3
"""Validate actual files and honest coverage of the creature avatar registry."""
import hashlib
import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'public/assets/creature-avatars'
m = json.loads((ASSETS / 'manifest.json').read_text())
assert m['schemaVersion'] == 1
assert m['variantPolicy'] == {'normal': 3, 'yolo': 1}
assert len(m['creatures']) == m['sourceRoster']['creatureCount'] == 2308
seen = set()
counts = {'complete': 0, 'partial': 0, 'pending': 0}
assets = 0
for slug, creature in m['creatures'].items():
    assert slug == creature['id']
    ids = set()
    for v in creature['variants']:
        assert v['id'] not in ids
        ids.add(v['id'])
        assert v['style'] in ('normal', 'yolo')
        p = (ASSETS / v['path']).resolve()
        assert p.is_relative_to(ASSETS.resolve())
        b = p.read_bytes()
        h = hashlib.sha256(b).hexdigest()
        assert h == v['sha256'] and len(b) == v['bytes']
        assert h not in seen, 'Duplicate image is not a distinct variant'
        seen.add(h)
        with Image.open(p) as im:
            assert im.format == 'WEBP' and im.size == (512, 512)
            im.verify()
        assert v['mime'] == 'image/webp'
        assert (v['width'], v['height']) == (512, 512)
        provenance = (ASSETS / v['provenance']['promptRef']).resolve()
        assert provenance.is_relative_to(ASSETS.resolve())
        info = json.loads(provenance.read_text())
        assert info['creatureId'] == slug and info['variantId'] == v['id']
        assert info['style'] == v['style'] and info['prompt']
        assets += 1
    expected_modes = {s: [v['id'] for v in creature['variants'] if v['style'] == s]
                      for s in ('normal', 'yolo')}
    assert creature['modes'] == expected_modes
    complete = all(len(expected_modes[s]) == n for s, n in m['variantPolicy'].items())
    status = 'complete' if complete else ('partial' if ids else 'pending')
    assert creature['status'] == status
    counts[status] += 1
assert m['coverage'] == dict(creatures=2308, **counts, verifiedAssets=assets, targetAssets=9232)
print(json.dumps(dict(**counts, verifiedAssets=assets, targetAssets=9232)))
