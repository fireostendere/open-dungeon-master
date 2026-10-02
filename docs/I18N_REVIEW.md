# RU/EN localization review

Status: incomplete. Passing JSX checks do not mean every dynamic catalog is translated.

## Implemented

- 898 named UI keys with English and Russian values; checked placeholders and parameter substitution in both languages.
- 124 class choices: titles, rules text and prerequisites, without changing stored option names.
- 350 equipment entries (SRD gear and bundled custom weapons/armor) with localized titles and available source descriptions.
- 43 glossary terms, 18 skills, 6 fighting styles, 13 standard backgrounds and alignment explanations.
- Inventory display, information dialogs, class choices, level-up choices, workshop glossaries and spell summaries now use locale-aware helpers.
- Russian rulebook remains complete: 933 pages, Cyrillic search and stable links.

## Outstanding findings

The dynamic-catalog audit still reports **769 unresolved records**:

| Source | Records missing Russian titles or descriptions |
| --- | ---: |
| `src/lib/classes/cyberpunk-features.json` | 119 |
| `src/lib/classes/dark-fantasy-features.json` | 126 |
| `src/lib/classes/horror-features.json` | 122 |
| `src/lib/classes/mystery-features.json` | 126 |
| `src/lib/classes/post-apocalyptic-features.json` | 118 |
| `src/lib/classes/steampunk-features.json` | 122 |
| `src/lib/backgrounds/catalog.json` | 36 |

These are 733 features of setting-specific classes and 36 setting-specific backgrounds. They remain visible in English and require translation; do not mark full localization complete.

Further paths needing explicit data-level coverage include custom class summaries/subclass labels, background starting gear and tool grants, world-pack summaries/reskins, starter-spell advice, and imported content outside the translated SRD. Existing user-authored names and narration must stay intact; missing translations for bundled content are defects, not permitted fallbacks.

The JSX scanner cannot prove that an arbitrary variable contains localized prose. `audit-content-localization.mjs` reads the source catalogs and calls the same display helpers as the UI; it prints each unresolved record with source, class, subclass and level. `--strict` fails while any record remains. Its scope currently covers class features and background entries, not every imported content pack.

## Reproduce

```bash
npm run i18n:check
node scripts/test-content-localization.mjs
node scripts/test-russian-content-coverage.mjs
node scripts/test-help-coverage.mjs
node scripts/test-item-sheet.mjs
node scripts/test-rulebook.mjs
node scripts/audit-content-localization.mjs --strict
```

The last command intentionally fails until the outstanding catalog translations are implemented.

Equipment regeneration uses the same pinned CC-BY-4.0 source as the rulebook (see `docs/LICENSES.md`):

```bash
node scripts/generate-equipment-copy.mjs <OmnisGM-Rules>/src/dnd/srd-5.1
```
