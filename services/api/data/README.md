# Reference Foods

`reference_foods.csv` is the list of Reference Foods (ADR 0023): generic foods with trusted Nutrition that every User can copy into their own Food with "Fill from reference". It is curated by hand and reviewed in PRs. Every deploy makes the `reference_foods` table match this file.

## Columns

| Column | Meaning |
| --- | --- |
| `id` | A UUID. The row's identity: never change it, never reuse it. |
| `name` | What the typeahead shows. Unique, ignoring case. Quote it if it contains a comma. |
| `basis_g` | The grams the next four values describe. 100 for "per 100 g", or a serving size. |
| `kcal` | Calories for the Basis. 0 to 10,000. |
| `protein_g`, `carbs_g`, `fat_g` | Grams for the Basis. Each from 0 up to `basis_g`. |
| `piece_g` | Optional. Grams in one item (one egg, one banana), so a count can be logged. Leave empty if the food is not counted. |

## Changing the list

- **Add a food:** append a row with a new id from `uuidgen`.
- **Correct a food:** edit its values and keep its id. Foods that Users already filled from it do not change: they hold a copy.
- **Remove a food:** delete its row. The next deploy deletes it from the table.

Check the file before pushing, from `services/api`:

```sh
uv run pytest tests/test_reference_foods.py
```

CI runs the same check, so a malformed file fails the PR instead of the deploy.
