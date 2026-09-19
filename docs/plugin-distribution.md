# Plugin distribution and sharing

Status: design. No code exists for this yet. This document records the decisions, so that the work
can start from an agreed shape.

## Why this document exists

The marketplace modal has a Plugins tab with a catalog list and a detail page
(`src/renderer/src/features/settings/MarketplacePluginDetail.tsx`). The tab has an agent picker
beside `Install plugin`, and a `Copy link` button. All of it reads story fixtures.

Two things are not decided:

- where the list of available plugins comes from;
- what a shared plugin link opens.

`Copy link` also copies `https://openbot.app/plugins/<slug>`. That host does not exist. The
canonical site is `https://openbot.run` (`packages/contracts/src/invite-links.ts`).

This document answers three questions:

1. How does the catalog of available plugins get to the app?
2. What does a shared plugin link open, in the browser and in the app?
3. What does "Install plugin" do, when an MCP server is host-global and a skill is per agent?

## Decisions already made

| Decision | Value |
| --- | --- |
| Catalog source | A static catalog on `openbot.run`. The app gets it and keeps a copy. |
| Not used | The Worker and D1 route that the skills and agents marketplaces use. |
| Submissions | Out of scope in this round. A plugin is added in the repository. |
| Install target | The app (the MCP server) is host-global. The skills go to the agent in the picker. |
| Scope | Catalog delivery and the public share link. |

`projection_mcp_servers` does not change. No migration is necessary for this work.

## 1. What a plugin is

A plugin is one developer's bundle. It contains:

- one **app**: an MCP server;
- the **skills** that tell an agent how to use that app;
- the listing text: name, tagline, description, example prompts, icon, category, version, and the
  developer's website, privacy policy and terms links.

The types in `src/renderer/src/features/settings/marketplace-plugins.ts` are the start shape.
They are local to the renderer today.

## 2. Catalog delivery

### 2.1 Source in the repository

The source mirrors `marketplace/production-catalog/`, which the skills catalog already uses:

```
marketplace/plugin-catalog/
  README.md
  catalog.json                      # the order of the slugs, and the featured flags
  plugins/<slug>/plugin.json        # listing text, links, prompts, the app, the skill pins
  plugins/<slug>/icon.svg
  plugins/<slug>/creator.png        # optional
```

### 2.2 What the app gets

The Account Worker (`apps/auth-api`) serves the catalog from its own bundle. The requests need no
account. `AGENTS.md` requires the app to work without an account, so the browse path must not use a
session token.

| URL | Content | Cache-Control |
| --- | --- | --- |
| `https://openbot.run/plugins/catalog.json` | The index: one summary for each plugin, with `detailSha256` | `public, max-age=300, stale-while-revalidate=3600, stale-if-error=86400`, and a strong `ETag` |
| `https://openbot.run/plugins/<slug>/<version>.json` | One detail: prompts, apps, skills, links | `public, max-age=31536000, immutable` |
| `https://openbot.run/plugins/assets/<name>.<sha8>.<ext>` | Icons and avatars | `public, max-age=31536000, immutable` |

The version is in the detail path and the content hash is in the asset name. Thus `immutable` is
correct: a change to the content gives a different URL.

Each file has a `schemaVersion`. The index also has a `catalogVersion`, which always increases.
If the `schemaVersion` is higher than the app knows, the app ignores the whole file and shows
"Update OpenBot to see the newest plugins." The app must not read a part of a file it does not know.

### 2.3 The detail shape

The detail gives the shape of the MCP server. It never gives a secret value.

```jsonc
{
  "schemaVersion": 1,
  "slug": "linear",
  "version": "1.4.0",
  "prompts": [{ "id": "p1", "text": "What is assigned to me this week?" }],
  "apps": [
    {
      "id": "linear-mcp",
      "name": "linear",
      "description": "Linear's MCP server.",
      "server": {
        "transport": "http",
        "url": "https://mcp.linear.app/mcp",
        "auth": [
          {
            "id": "api-key",
            "kind": "key",
            "label": "API key",
            "docsUrl": "https://linear.app/settings/api",
            "fields": [
              {
                "id": "token",
                "label": "Linear API key",
                "header": "Authorization",
                "prefix": "Bearer "
              }
            ]
          }
        ]
      }
    }
  ],
  "skills": [
    {
      "id": "skill-linear-triage",
      "versionId": "skill-linear-triage-3-8f14e45f",
      "slug": "linear-triage",
      "description": "Triage and update Linear issues."
    }
  ]
}
```

`auth` lists the ways into the server, as the shipped `McpConnectFlow[]` in
`packages/contracts/src/ipc-plugin-catalog.ts` declares them: a `"link"` flow signs in through the
browser, a `"key"` flow names each field and where its value goes. The user types the value in the
existing MCP server form. A secret is never in a public file, in a log, or in an export.

The skills are pins into the skills marketplace. They are `marketplace_skills` identifiers and
version identifiers. Thus the install reuses `installVersion` in
`src/main/skill-marketplace-service.ts`. The catalog carries no bundle bytes.

### 2.4 How the catalog is published

A new `scripts/build-plugin-catalog.ts` reads `marketplace/plugin-catalog/`. It follows
`scripts/build-production-catalog.ts`. It hashes the icons and the details, and it writes:

- a generated module in `apps/auth-api`, which the routes import. The module is committed;
- the offline snapshot in `resources/plugin-catalog/`.

The existing `scripts/deploy-auth-api.ts` then ships the catalog with the Worker. There is no D1
step, no R2 step and no admin token. This is the reason for the static route.

The build script refuses:

| Condition | Reason |
| --- | --- |
| A value that looks like a secret | A public file must hold no secret. |
| `workingDirectory` in a server | ACP drops a server that has one (`src/backend/mcp-provider-shapes.ts`). |
| A name in `RESERVED_MCP_SERVER_NAMES` | The machine keeps those names. |
| A config that `mcpConfigErrors(normalizeMcpConfig(config))` rejects | The catalog must not describe a server that the settings form refuses. |
| A skill `versionId` that is not published | The install would fail for all users. |
| More than one app in a plugin | Version 1 keeps the install simple. The array stays for later. |

A `--check` mode fails when the generated module is not the same as a fresh build. CI runs it, so a
hand-edited generated file cannot ship.

Publish order: publish the skills first with `scripts/publish-production-catalog.ts`, then deploy the
Worker. The build script tests that each pinned skill version exists.

### 2.5 Integrity

Two controls protect the catalog:

- HTTPS to `openbot.run`, which is a Cloudflare custom domain;
- `detailSha256` in the index. The main process compares the hash after each detail download. This
  is the control that `src/main/skill-marketplace-service.ts` already uses for a skill bundle
  (`sha256(bundle) === detail.bundleSha256`).

There is **no signature**. The party that holds a signing key would also be the party that deploys
the Worker that serves the file. Thus a signature would protect against nothing new. Add a signature
only if the catalog moves to a host that OpenBot does not control.

### 2.6 Fetch and cache in the app

A new `src/main/plugin-catalog-service.ts` owns this. `src/main/application-services.ts` builds it.
It does not use `CentralAuthManager`, because the browse path must work when the user is not signed
in.

| Item | Decision |
| --- | --- |
| Cache file | `userData/plugin-catalog.json`, written to a temporary file and then renamed. It holds the `ETag`, `fetchedAt`, the index, and the last 100 details. |
| No new table | The catalog is a remote cache. The database is the source of truth, not a cache. A migration is irreversible, and a cache file can be deleted and built again. |
| Freshness | `If-None-Match` with the stored `ETag`. A soft limit of 6 hours. A timeout of 10 seconds. |
| Refresh | On the first list after the app starts, on a list when the copy is old, and when the user asks. There is no background timer. |
| Details | Read when the user opens a listing. The hash is checked. A wrong hash is a hard failure. |
| First run offline | The snapshot in `resources/plugin-catalog/` ships with the app through `extraResources` in `electron-builder.yml`. The app uses the newer of the snapshot and the cache, by `catalogVersion`. |
| Logs | Status codes and `catalogVersion` only. Never a response body. |

The renderer shows three failure states:

- stale: "Showing the catalog from <time>. OpenBot could not reach openbot.run.";
- cold and offline: "Plugins need a connection to openbot.run the first time.";
- wrong hash: "This plugin listing did not match its checksum. Try again later."

### 2.7 Contracts and IPC

The plugin types move from the renderer to `packages/contracts/src/ipc-plugin-catalog.ts`. The
renderer file exports them again, in the way that `src/renderer/src/features/servers/mcp-servers.ts`
does over `packages/contracts/src/ipc-mcp-servers.ts`.

New channels: `plugins:list`, `plugins:get`, `plugins:install-state`, `plugins:install`,
`plugins:uninstall`. Each one gets a decoder in `src/preload/index.ts` and a mirror in
`src/renderer/src/preview/mock-openbot.ts`. `src/main/ipc-channel-coverage.test.ts` enforces the
mirror.

## 3. What "Install plugin" does

The app is host-global. The skills are per agent. The user picks the agent in the picker on the
listing page.

1. Read the detail, and check its hash.
2. Check before any write: build the `McpServerConfig`, run `mcpConfigErrors`, and refuse a reserved
   name or a name that another plugin uses.
3. Install each pinned skill into the chosen agent with
   `installVersion({ agentId, skillId, versionId })` in `src/main/skill-marketplace-service.ts`.
4. Save the MCP server with `saveMcpServer` in `src/backend/agent-service.ts`, which writes through
   `src/backend/mcp-server-store.ts` and then refreshes each agent runtime. The server is saved with
   `enabled: false` when it needs credentials. A server that cannot connect must not go to each agent
   on the machine.
5. Write a receipt in `userData/plugin-installs.json`.
6. If the app needs credentials, send the user to the MCP server form. The form is filled from the
   record and shows the `helpUrl`. Only the user types the secret.

The skills are installed before the app. Thus a failure leaves no server that has no skills.

### 3.1 Failure

A failure removes the skills that this attempt installed, and does not write the MCP record.
`src/main/agent-marketplace-service.ts` already works in this way. A skill that the agent had before
the attempt stays. A failed receipt write does not cancel the install, because the state is read
again from the store.

### 3.2 What "Installed" means later

`plugins:install-state` does not trust the receipt. For each plugin it tests:

- the app is installed when the MCP record still exists. The user can delete it in settings;
- a skill is installed when the agent's `<workspace>/.openbot/skills-lock.json` still lists it.

A newer version in the index makes the button show "Update". If the receipt is lost, the app can
find a probable install, but it then offers "Reinstall" and not a version.

### 3.3 Uninstall

Uninstall removes the plugin's skills from that agent. It removes the app only when no other agent
uses the plugin, and only after the user agrees. The app is host-global, so a silent removal would
stop another agent from working.

### 3.4 Known limits

| Limit | Effect |
| --- | --- |
| Codex accepts `stdio` only | An `http` app does nothing on a Codex agent, and gives no error. Show this on the listing. |
| `mcp-servers-v1` is frozen | The install writes local records only. A team server is out of scope. |
| A skill download needs a session | A plugin that has skills needs a signed-in account. A plugin that has an app only installs when the user is not signed in. |

## 4. The public share link

### 4.1 The page

`apps/auth-api/src/routes/plugins/$slug/index.tsx` shows one plugin. `apps/auth-api/src/routes/plugins/index.tsx`
lists them. Both read the same generated module as the JSON routes, so there is one source.

The page follows `apps/auth-api/src/routes/guides/$slug.tsx`:

- the `loader` finds the plugin and throws `notFound()` when the slug is unknown, so the status is a
  true 404. The page for a missing plugin gives a next step: the plugin list, and the download link;
- the head tags follow `articleHead` in `apps/auth-api/src/lib/content-metadata.ts`. The canonical
  URL comes from the site URL of the server that answers, so a preview does not name production;
- `SoftwareApplication` structured data gives the name, the description and the version;
- `contentSitemapXml()` in `apps/auth-api/src/server/content-feed.ts` gets `/plugins` and one entry
  for each plugin. The JSON URLs stay out of the sitemap, because they are data and not pages.

The page is indexable and cacheable. `/join` is neither, because an invite URL holds a token. A
plugin link holds no secret.

The page shows the listing text, the example prompts as text, the apps, the skills, the developer,
the version, and the developer's links. It does not show install counts, account state, or the MCP
server address. A reader must not learn how to add the server by hand and miss the app's checks.

The page has one main button, `Open in OpenBot`, and a second button, `Download OpenBot`.

### 4.2 The link shapes

```
https://openbot.run/plugins/<slug>    the link a person shares and the app copies
openbot://plugins/<slug>              the link the page button opens
```

A new `packages/contracts/src/plugin-links.ts` holds these. `packages/contracts/src/invite-links.ts`
does not change, so no invite rule becomes weaker.

The host gives the kind and the path gives the argument. `parseInviteUrl` already uses this rule
(`hostname === "join"`). An invite needs four fields and thus needs a query. A plugin needs one
identifier, so a path segment is sufficient. A query form would invite growth, such as
`?install=1`, which this design refuses.

The parser accepts a URL only when:

- the protocol is `openbot:` with the host `plugins`, or the origin is exactly
  `https://openbot.run` with the path prefix `/plugins/`;
- there is exactly one path segment after the prefix;
- the search, the hash, the port, the user name and the password are empty;
- the slug matches `^[a-z0-9][a-z0-9-]{0,62}$`. Thus a slug cannot contain a dot, and cannot hide
  the `catalog.json` route.

### 4.3 The main process

A new `src/main/deep-link-router.ts` holds the kinds:

```ts
export type DeepLink = { kind: "invite"; url: string } | { kind: "plugin"; slug: string };
```

| Kind | Custom scheme | Effect |
| --- | --- | --- |
| `invite` | `openbot://join?…` | Opens the join dialog, as today. |
| `plugin` | `openbot://plugins/<slug>` | Opens the marketplace listing. |
| other | — | The URL is dropped without a message, as today. |

The invite parser runs first, so an invite URL never reaches the plugin parser. `src/main/index.ts`
keeps one pending link and one ready flag. The existing "take pending invite" request gives a value
only when the kind is `invite`.

Universal links stay with the invite. `/plugins/*` is not added to the Apple app site association
file, so a share page stays readable for a reader who has no app.

### 4.4 In the app

The link raises and focuses the window, and then opens Settings, Marketplace, the Plugins tab, and
that listing. The transport copies the invite mechanism: an event `plugins:open-listing` and a
request `plugins:take-pending-listing`, read in `src/renderer/src/app-bootstrap.tsx`. The pending
value is necessary, because a message to a window that still loads is lost.

**The link never installs.** No path from the router reaches the install action. The user must press
the install button and choose an agent.

When the slug is not in the copy of the catalog, the main process reads it. The renderer does not
fetch, so the `connect-src` policy does not change. Two states follow:

- `missing`: "This plugin is not in the OpenBot catalog." This is final, and gives a button back to
  the plugin list;
- `offline`: "OpenBot cannot reach openbot.run. Check your connection." This gives "Try again".

### 4.5 Copy link

`shareUrl` leaves the plugin type. The app builds the link from the slug with
`createPluginShareUrl(slug)`. Thus catalog data cannot put a foreign URL behind a button that the
user trusts. The clipboard gets exactly `https://openbot.run/plugins/<slug>`, with no query and no
tracking field.

The button becomes the existing `CopyButton` in `src/renderer/src/components/ui/button.tsx`, which
holds the copied state and announces "Link copied".

### 4.6 External links

Each external URL goes through `safeBrowserUrl`, which accepts `http:` and `https:` only, and then
through `openUrl`, which opens the system browser. The renderer never navigates to a remote page and
never opens a window. This design adds nothing to the navigation policy.

## 5. Security

| Attack | Control |
| --- | --- |
| A link installs a plugin without agreement | The link opens the listing only. The install is a separate press with an agent choice. A test enforces this. |
| A path attack, such as `openbot://plugins/../join?…` | One path segment, and the slug pattern. The invite parser owns `join`. |
| Extra fields in the link, such as `?install=1` | The search and the hash must be empty. |
| A similar host, such as `openbot.app` or `openbot.run.example.com` | The origin is compared as a whole string. No `endsWith` and no expression on the host name. |
| A `javascript:` or `file:` URL in catalog data | `safeBrowserUrl` accepts `http:` and `https:` only, and the share URL is built and not read. |
| The slug used as a file path | The slug is checked at the IPC boundary, and it never builds a path. |
| Many links raise the window | One pending link is kept. A second link replaces the first. |
| The page learns that the app is installed | The page has no timer, no automatic redirect and no hidden frame. |
| A secret in a URL | A plugin link has no secret. This is the reason that the page, unlike `/join`, is indexable. |

Degraded conditions:

| Condition | Result |
| --- | --- |
| `openbot.run` is not available, and the plugin is in the cache | The listing opens from the cache. There is no request. |
| `openbot.run` is not available, and the plugin is not in the cache | The `offline` state, with "Try again". |
| The plugin is no longer in the catalog | The `missing` state. |
| The reader has no app | The page stays readable, and offers the download. |
| The app is older than the link kind | The URL is dropped without a message, as today. |

## 6. Tests that are mandatory

This work changes the renderer-to-main boundary and the IPC contracts, so `AGENTS.md` makes tests
mandatory.

| File | What it proves |
| --- | --- |
| `packages/contracts/src/plugin-links.test.ts` | Both forms are built and read again. A wrong origin, `http:`, a second path segment, `..`, a query, a hash, a port, a user name, an upper-case slug and a long slug are refused. An invite URL is refused. |
| `src/main/deep-link-router.test.ts` | The kind table. An invite still reads as an invite. An unknown `openbot://` URL gives nothing. |
| `src/main/ipc/plugin-handlers.test.ts` | The sender check runs before the payload is read. A bad slug is refused. The pending link is given one time. |
| `src/main/plugin-catalog-service.test.ts` | A 304 answer, a wrong hash, the offline fallback, the choice between the snapshot and the cache, and a part-completed install. |
| `src/main/ipc-channel-coverage.test.ts` | Exists. It fails until the channels are in the contracts, the preload and the mock. |
| `src/renderer/src/features/settings/SkillsMarketplaceModal.test.tsx` | A slug opens the Plugins tab and that listing, no install call is made, an unknown slug shows the `missing` state, and `Copy link` writes the canonical URL. |
| `apps/auth-api/test/` page and metadata tests | The page shows the listing and both buttons. The canonical URL and the sitemap are correct. An unknown slug gives a 404. |

## 7. Open questions

Ordered by cost.

1. The split between a host-global app and per-agent skills must be stated in the interface. If it
   is not, a user disables an app and stops another agent from working.
2. A plugin that has skills needs an account, but browse does not. A public route for a skill
   version would remove this difference. That is a separate decision.
3. An MCP server that uses OAuth does not fit the header and environment credential model.
4. The plugin catalog and the skills catalog can differ for one deploy. The build check and the
   publish order reduce this, but do not remove it.
5. `installs` counts are fixed numbers in the source files. Nothing increases them. Hide that sort
   order, or keep the numbers by hand and say so.
6. One index file is sufficient for now. A larger catalog needs a split by category, which the
   `schemaVersion` permits.
7. A version in the deep link (`openbot://plugins/<slug>@1.2.0`) is deferred. It needs an answer for
   a version that is no longer published.
8. A social card for each plugin is deferred. Version 1 uses the site card.

## 8. Order of work

1. ~~Correct the fixture host to `openbot.run`, and build the share URL from the slug.~~ Done:
   `createPluginShareUrl` in `src/renderer/src/features/settings/marketplace-plugins.ts`.
2. `marketplace/plugin-catalog/` and `scripts/build-plugin-catalog.ts`, with fixtures and `--check`.
3. The Worker routes: the JSON first, then the page and the sitemap entries.
4. The contract types, the channels, the decoders, the preload and the mock.
5. `src/main/plugin-catalog-service.ts`: the request, the cache and the snapshot.
6. ~~Connect the Plugins tab to the real data. Keep the fixtures for Storybook.~~ Partly done: the
   tab reads `src/renderer/src/features/settings/marketplace-plugin-catalog.ts`, a literal in the
   renderer with one listing. Steps 2 to 5 replace that literal; nothing the tab renders changes.
7. Install and uninstall. Install is done: the page installs each pinned skill into the agent in the
   picker, then saves the listing's MCP server through `saveMcpServer` on the selected host. It
   reads the installed state back from `listMcpServers` and from the agent's installed skills, so a
   listing counts as installed only when both halves are present. A skill installs by published
   version through the optional `versionId` on `skills.install`, which the main process routes to
   `installVersion`. A failure unwinds the skills this attempt installed, and writes no MCP record.
   Uninstall is not built: the user removes the server in the MCP settings panel and the skill in
   the agent's skills panel.
8. ~~The deep-link router and the share link.~~ Done. `src/main/deep-link-router.ts` decides which
   kind an `openbot://` link is, `openbot://plugins/<slug>` opens that listing in the Plugins tab
   and installs nothing, and `openbot.run/plugins/<slug>` now answers, so the detail page offers
   `Copy link` again. The public pages read the same catalog the tab reads, from
   `packages/contracts/src/plugin-catalog.ts`.
