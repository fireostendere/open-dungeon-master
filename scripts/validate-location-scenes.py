#!/usr/bin/env python3
"""Check the location plan, generated files and honest coverage counts."""
import hashlib
import json
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "public/assets/location-scenes"
manifest = json.loads((ASSETS / "manifest.json").read_text(encoding="utf-8"))
assert manifest["schemaVersion"] == 1
assert manifest["language"] == "en"
assert manifest["delivery"]["aspectRatio"] == "16:9"
assert len(manifest["locations"]) == manifest["sourceRoster"]["locationCount"]
statuses = Counter(complete=0, partial=0, pending=0)
targets = Counter(normal=0, yolo=0)
seen = set()
for slug, location in manifest["locations"].items():
    assert re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", slug), slug
    assert location["category"] in manifest["categories"], slug
    assert location["name"] and len(location["description"].split()) >= 12, slug
    assert not re.search(r"[\u0400-\u04ff]", location["description"]), slug
    assert location["tags"] and all(location["tags"]), slug
    target = manifest["variantPolicy"][location["frequency"]]
    assert location["targetVariants"] == target, slug
    assert all(isinstance(n, int) and n > 0 for n in target.values()), slug
    targets.update(target)
    counts = Counter(normal=0, yolo=0)
    ids = set()
    for variant in location["variants"]:
        assert variant["id"] not in ids, slug
        ids.add(variant["id"])
        assert variant["style"] in target, slug
        assert variant["description"] and variant["tags"], slug
        assert not re.search(r"[\u0400-\u04ff]", variant["description"]), slug
        path = (ASSETS / variant["path"]).resolve()
        assert path.is_relative_to(ASSETS.resolve()), path
        data = path.read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        assert digest == variant["sha256"] and len(data) == variant["bytes"], path
        assert digest not in seen, "Duplicate image is not a distinct variant"
        seen.add(digest)
        from PIL import Image
        with Image.open(path) as image:
            assert image.format == "WEBP", path
            assert image.size == (manifest["delivery"]["width"], manifest["delivery"]["height"]), path
            assert image.size == (variant["width"], variant["height"]), path
            image.verify()
        assert variant["mime"] == "image/webp", path
        assert variant["provenance"]["prompt"], path
        counts[variant["style"]] += 1
    assert all(counts[style] <= amount for style, amount in target.items()), slug
    status = "complete" if counts == target else ("partial" if ids else "pending")
    assert location["status"] == status, slug
    statuses[status] += 1
assert {p.resolve() for p in ASSETS.rglob("*.webp")} == {
    (ASSETS / variant["path"]).resolve()
    for location in manifest["locations"].values() for variant in location["variants"]
}, "Unregistered or missing image"
assert manifest["coverage"] == dict(
    locationTypes=len(manifest["locations"]), **statuses,
    verifiedAssets=len(seen), targetAssets=sum(targets.values()), targetByStyle=dict(targets)
)
for slug, target in {"tavern": {"normal": 10, "yolo": 4},
                     "cemetery": {"normal": 4, "yolo": 2},
                     "volcanic-crater": {"normal": 1, "yolo": 1}}.items():
    assert manifest["locations"][slug]["targetVariants"] == target, slug
print(json.dumps(manifest["coverage"]))
