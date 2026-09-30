# Creature avatar library (work in progress)

The manifest preserves all **2,308** creature IDs from the supplied bestiary.
Target: **3 normal + 1 YOLO avatar per creature = 9,232 images**.
See manifest.coverage for the current completed and pending counts. An empty variants array is not an
image and must not be treated as completed coverage.

## Integration

Use the exact creature slug as `manifest.creatures[slug]`. Choose `normal`
or `yolo` from its `modes` arrays, then resolve that variant ID in `variants`.
Join `manifest.assetBaseUrl` with the variant's relative `path`. If no IDs
are available for the requested mode, preserve the caller's existing fallback.
No runtime campaign integration is included in this asset-only change.

Files are 512 x 512 WebP, quality 88, with independent compositions and
characters. YOLO means absurd dark-comedy artwork, not object-detection labels.
The user approved this style and scripted thumbnail conversion.

## Provenance and rights

Each image is an original OpenAI image_gen output. The matching provenance
JSON contains the actual generation prompt. No publisher illustrations were
downloaded, copied, or relabeled as openly licensed artwork. The manifest's
`generated-output` label records origin, not a third-party CC license or a
claim of exclusive copyright. Creature source names describe the supplied
roster, not the artwork's license. No publisher rules or flavor prose is copied.

Full-resolution originals are retained separately from the repository.
The manifest records their SHA-256 hashes. Do not add multi-megabyte masters
to this folder. The repository contains only optimized delivery variants.

## Validation

Run `python3 scripts/validate-creature-avatars.py` from repository root.
Python Pillow is required for image decoding. It verifies coverage, safe paths,
style counts, source prompt references, hashes, dimensions and decoded WebP files.
It rejects duplicate image bytes, absent files and any false completed status.
This is asset validation only; no application runtime behavior is changed.
