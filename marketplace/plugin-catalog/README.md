# Plugin catalog source

One developer bundle per directory: `plugins/<slug>/plugin.json`.
`catalog.json` sets the order and the featured flags.
`scripts/build-plugin-catalog.ts` validates the source and writes three
generated outputs; never edit those by hand:

- `src/renderer/src/features/settings/marketplace-plugin-catalog.ts` (Plugins tab)
- `apps/auth-api/src/lib/plugin-catalog.generated.ts` (Worker JSON routes)
- `resources/plugin-catalog/` (offline snapshot shipped with the app)

```sh
bun run marketplace:build:plugins
bun run marketplace:build:plugins -- --check
```

Rules for a new entry:

- One app per plugin. Skills stay `[]` until pinned skill versions exist.
- No secret values anywhere in this directory. Auth declares where a
  credential goes (`header` for http, `env` for stdio); the user types the
  value in the connect dialog.
- `http` servers take a `url`. `stdio` servers take a `command` and `args`.
  No `workingDirectory`: the provider drops such servers.
- Names must pass `mcpConfigErrors` and must not be reserved (`openbot`).
- OAuth-only vendors install as `npx mcp-remote@latest <url>` over stdio,
  the same bridge the Canva listing uses, because the main process signs in
  through the bridge rather than with an OAuth client of its own.
