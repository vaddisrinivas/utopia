# Food package source split

## What this is

- `apps/food/food.v1.json` stays the runtime artifact.
- `apps/food/source/` is the reviewable source view.
- `scripts/quality/split-food-package-source.mjs` derives the source files from the current JSON.

## Layout

- `apps/food/source/index.json`: map of top-level keys to chunk files.
- `apps/food/source/chunks/*.json`: one chunk per top-level key.

## Split rule

- Each top-level key becomes one chunk.
- No product content is edited by hand.
- The script reassembles the chunks and checks they match the original JSON.

## Regenerate

```bash
node scripts/quality/split-food-package-source.mjs
```

## Notes

- This split is read-only for runtime behavior.
- If the package grows again, the script can be extended to split large subtrees later.
