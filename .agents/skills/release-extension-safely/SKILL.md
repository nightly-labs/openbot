---
name: release-extension-safely
description: Audit a pending OpenBot Chrome extension release for hazards before a release tag sends it to the Chrome Web Store, and run the Release browser extension workflow by hand when the automatic run stopped. Use when asked to release, publish, upload or submit the browser extension, to make the Chrome Web Store zip, or to check whether an extension change is safe to ship.
---

# Release the extension safely

Chrome updates each installed copy of the extension by itself, a few hours after the store approves
a version. Users do not choose the time and cannot go back. A hazard that ships reaches every user:

- A new permission with a warning **disables the extension for every user** until each user accepts
  it on `chrome://extensions`. Many users never do.
- A renamed `chrome.storage.local` key or a decoder that refuses the old shape signs users out or
  loses their settings. There is no read path back.
- The extension speaks the Team API to hosts that you do not update, and calls the production
  account service, which may not have the new route yet.
- The store accepts each `version` only once, and only if it is higher than the last one.

Each release tag publishes the extension automatically: `.github/workflows/release-extension.yml`
builds the zip from the tag and submits it to the store with automatic publish
([Browser extension](../../../docs/RELEASING.md#browser-extension)). Its script stops on a dev build,
a source map, a wrong version and new permissions or match patterns (gate B). It cannot see gates
C, D and E. Run this audit before the release tag that carries an extension change, so that a
hazard stops the tag and not the users.

## What this skill does and does not do

- It audits. When the automatic run stopped, it starts the workflow by hand on the tag (Step 3).
- It does not bump the version, push a tag or deploy the account service. It sets
  `allow_new_permissions` or `replace_pending` only when the developer says so.
- It does not run `bun run check`, `bun run test`, `bun run lint` or `bun run typecheck`. Run only
  `bun run typecheck:extension`, the extension build, and the checks that a gate names.
- It does not run `bun run dev:seed`, `dev:reset` or `pkill -f`.

## Subagents and models

Give each triggered gate to its own subagent when the range is large. Set the model on each spawn.

| Tier | Claude Code | Tasks |
| --- | --- | --- |
| Strong | the session model | Step 1 residue, gates B, C and D, the Step 4 verdict |
| Medium | `sonnet` | gates E and F |
| Small | `haiku` | gate A, Step 3, `git grep` inventories |

Check the evidence of each report before you accept it. A "no hit" passes only when the command can
still find a hit (see Step 2).

## Step 1 — find the range, then account for every file in it

The manifest `version` is the root `package.json` version, so each store version is the version of
a desktop release tag `v<version>`.

```bash
git status --porcelain
git fetch --tags origin
git tag --list 'v*' --sort=-v:refname | head -1
```

**Stop if the tree is not clean.**

Read the last version that the store published from the public package. Do not guess it: no tag
records it.

```bash
curl -sSL -o /tmp/openbot-public.crx \
  'https://clients2.google.com/service/update2/crx?response=redirect&prodversion=142.0&acceptformat=crx3&x=id%3Deggdpikcggoicfcfdpdihfkinajchpfj%26uc'
unzip -p /tmp/openbot-public.crx manifest.json | jq -r .version
```

The range is `v<last published>..v<new version>`. The new version must be a released tag that
contains `apps/browser-extension`; build from the tag only.

**First store release.** When the store has no published version, there is no installed user and
no range. Gate C is not triggered. Gates B, D and E check the full manifest and code of `v<new>`
instead of a diff: each permission needs a dashboard justification, and each account route must
exist in production.

```bash
git diff --name-status v<last>..v<new> -- apps/browser-extension packages/contracts packages/team-client \
  packages/i18n packages/ui packages/brand packages/telemetry package.json bun.lock PRIVACY.md \
  .github/workflows/release-extension.yml
```

Then find what the extension imports from outside these paths, and add it:

```bash
git grep --no-color -h -o -E "from \"(@openbot/[a-z0-9-]+|\.\./\.\./[^\"]+)" -- apps/browser-extension | sort -u
```

Route each changed file to a gate, or dismiss it with a reason that you can state. `packages/ui`
and `packages/i18n` changes that are only visual or text are dismissed with "UI only". Stories and
docs are not in the zip. Report the count of files that you could not account for.

## Step 2 — the gates

Report each gate as **pass**, **stop**, **needs a human** or **not triggered**. Never drop a gate.

Some checks pass when a command prints nothing. Before you trust that, run the same command over a
range or a file that you know has a hit.

### A. Version and build

Always triggered.

- `v<new>` > `v<last>` in semver. Equal is a stop: the store refuses it.
- `apps/browser-extension/vite.config.ts` still takes `version` from the root `package.json`.
- The production build is correct. Build it from the tag in a clean state and read the manifest:

  ```bash
  git switch --detach v<new>
  bun run --cwd apps/browser-extension build
  jq '{name, version, host_permissions, permissions, externally_connectable, content_scripts}' \
    apps/browser-extension/dist/manifest.json
  find apps/browser-extension/dist -name '*.map' | wc -l
  ```

  Stop if `name` is `OpenBot (Dev)`, if any URL has `localhost` or `127.0.0.1`, or if a `.map` file
  exists. Switch back to the original branch when you are done.

### B. Permissions and match patterns

Triggered by `apps/browser-extension/vite.config.ts` and by anything that it imports.

Compare the manifest of `v<last>` with the manifest of `v<new>`. Build both, or read the
`extensionManifest` hunks. Check `permissions`, `optional_permissions`, `host_permissions`,
`content_scripts[].matches`, `externally_connectable.matches` and `web_accessible_resources`.

- An added permission or host that has a Chrome warning: **stop** unless the developer confirms it.
  Chrome disables the extension on update until the user accepts. The list of warnings is in
  <https://developer.chrome.com/docs/extensions/develop/concepts/permission-warnings>.
  Recommend `optional_permissions` and a request at the time of use where it can work.
- An added permission without a warning (such as `alarms`): pass, and note that the dashboard
  Privacy tab needs a justification for it before review.
- A removed permission or host: check that no code path still uses it. Grep for the `chrome.<api>`.
- A changed `externally_connectable` origin: check the web pages that send messages to the extension.

### C. Stored state

Triggered by any change to a file that reads or writes `chrome.storage` or defines a storage key.
Derive the set; do not trust a list:

```bash
for ref in v<last> v<new>; do
  git grep --no-color -l -E "chrome\.storage|_KEY =|_PREFIX =" "$ref" -- apps/browser-extension/src
done | sed 's/^[^:]*://' | sort -u | xargs -r git diff --no-color v<last>..v<new> --
```

The grep runs on both refs, so a key file that the range deleted or moved shows as removed lines.
The loop alone must list files: `extension-storage.ts` and `client-browser-messages.ts` own keys.
An empty list means a wrong tag or a broken pattern. Stop and fix the command.

- A renamed or removed key, or a `.v1` → `.v2` change, needs a read of the old key in the new
  version, or a written reason that the loss is acceptable. Else **stop**. `openbot.session.v1`
  loss signs every user out.
- A decoder (`decode*`, `isDynamicRecord` checks) that now refuses a shape that `v<last>` wrote is a
  **stop**. Find the old writer in `v<last>` and compare.
- `chrome.runtime.onInstalled` with `reason: "update"` code in `background.ts`: read it. It runs once
  for every user on update.

### D. Wire to hosts and the account service

Triggered by `packages/contracts/src/team-protocol/`, `packages/team-client/`,
`packages/contracts/src/browser-extension-x.ts`, and the extension files that call them
(`host-connection.ts`, `workspace.ts`, `account.ts`, `background.ts`, `x-agent.ts`, `client-browser-*`).

- **Hosts.** The extension updates within hours; hosts keep the releases of the last 60 days
  (`AGENTS.md`, Team API support window). Each new host request must be gated on a host capability
  (`has("<capability>")` in `workspace.ts`). A new request with no gate is a **stop**: hosts in the
  window answer it with an error. A frozen Team API codec or fixture that changed meaning is a
  **stop**; use the gate C rules of the release-upgrade-safety skill.
- **Account service.** List the routes that the extension calls in `v<new>`, with the `team-client`
  routes (`remote-directory.ts` calls `/v2/remote/...`) and template strings:

  ```bash
  git grep --no-color -h -o -E "[\"\`]/v[0-9]+/[^\"\` ?]*" v<new> -- apps/browser-extension/src \
    packages/team-client/src packages/contracts/src/browser-extension-x.ts | sed 's/^.//' | sort -u
  ```

  The list must have `/v1/mobile-auth/session` and `/v2/remote/hosts/` routes. Run it on `v<last>`
  too, and compare. For each route that is new in the range, put `x` in place of each `${...}` part
  and check that production has it now:
  `curl -s -o /dev/null -w '%{http_code}\n' -X OPTIONS https://api.openbot.run<route>`. A `404` is a
  **stop**: deploy the account service first. Do not deploy it from this skill.

### E. Store policy and privacy

Triggered by `analytics.ts`, `background.ts`, any new `fetch(`, `import(` or `chrome.scripting`
call, and `PRIVACY.md`.

- Manifest V3 refuses remote code. Code that the extension runs must be in the zip. A new
  `import()` of a URL, `eval`, `new Function`, or a script that is fetched and run is a **stop**.
  Fetched data (such as the X page rules) is permitted.
- New data that leaves the browser (a new analytics event, property or endpoint): `PRIVACY.md`
  must say it in the same range, and the dashboard Privacy tab ("Data usage") may need a change.
  Report **needs a human** for the dashboard part.
- Secret redaction applies to every send path (`AGENTS.md`, Non-negotiable).

### F. Live check

Always triggered. The fakes do not prove that the zip works in Chrome.

Run `bun scripts/browser-extension-e2e.ts --agent=<agent id> --auth-api=<url>` against this
worktree's `bun run dev` stack (the `smoke` skill starts it). It writes its report under
`.openbot-build/`. Then load `apps/browser-extension/dist` from the production build with
**Load unpacked** in a Chrome profile of its own, and check that the side panel opens and shows the
sign-in screen. A failure that the range causes is a **stop**. A dev stack that does not start is
**needs a human**.

## Step 3 — the store run

The tag push starts the workflow. Find its run and read the job summary:

```bash
gh run list --workflow release-extension.yml --event push --limit 5 \
  --json databaseId,headSha,headBranch,status,conclusion,url
```

- `headSha` must be the commit of `v<new>` (`git rev-list -n1 v<new>`).
- The run summary says that the version was submitted, or why it was not. The `package` job
  writes the permission stop; when it stops, the `publish` job is skipped. The `publish` job writes
  the store result and a warning when it skipped the upload.

When it stopped on new permissions that the developer confirmed, or the developer wants to replace a
version in review, run it by hand on the tag:

```bash
gh workflow run release-extension.yml --ref v<new> -f publish=true \
  -f allow_new_permissions=<true|false> -f replace_pending=<true|false>
```

To check a zip without the store, run the workflow on a branch with no inputs, or run
`bun scripts/chrome-web-store-release.ts check <zip>` locally.

## Step 4 — report and hand off

| Gate | Triggered by | Verdict |
| --- | --- | --- |
| A. Version and build | always | pass / stop / needs a human |

Add the range, the count of files that you could not account for, the workflow run URL, and the
store state.

Any of these means **do not release the tag**, or, after the tag, cancel the review in the
Developer Dashboard:

- `v<new>` is not higher than the last published version;
- a dev build, a `localhost` host or a source map in the zip;
- a new permission or host with a warning that the developer did not confirm;
- a renamed storage key or a stricter decoder with no read path for the old data;
- a new host request with no capability gate, or a changed frozen Team API codec;
- an account service route that production does not have;
- remote code;
- a live check failure that the range causes.

If all gates pass, hand off to the developer: fill in a justification for each new permission and
update the Privacy tab if gate E says so. The store reviews each version before Chrome updates users.
