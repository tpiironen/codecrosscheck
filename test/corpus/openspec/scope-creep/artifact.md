# OpenSpec change: add-search

## Impact
- Affected specs: `search`
- Affected code: `src/server/search.ts`

## Diff

```diff
diff --git a/src/server/search.ts b/src/server/search.ts
+ // search endpoint
diff --git a/src/billing/invoice.ts b/src/billing/invoice.ts
+ // unrelated billing change snuck in
diff --git a/infra/main.bicep b/infra/main.bicep
+ // unrelated infra change snuck in
```
