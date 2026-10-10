# Electron release UI tests

The Playwright suite tests the built Electron app. Release publication requires both the macOS
and Linux jobs in `.github/workflows/electron-e2e.yml`. The release workflow calls this workflow
for each release tag. Its manual trigger can test a commit already on `main` before a tag is made.
It does not run on pull requests.

## Coverage

Each scenario runs in two modes:

- `local`: actions run in the local Electron app and its workspace.
- `host`: a second Electron app signs in with another development account, accepts an admin
  invitation, and connects to the owner through the real account service, Signal, and WebRTC.
  The test requires the `webrtc-v2` transport. It checks generated files on the owner.

The host is a separate process on the test machine. This checks the remote-client path but does
not measure a network between two physical computers, TURN relay operation, or hosted deployment.

| Area | Required behavior in both modes |
| --- | --- |
| Chat | Send, stream, follow up, stop, send again, edit/delete queued input, retain history and identity after restart, reconnect without duplicate results |
| Agents | Create a persistent child, inherit provider/model, deliver its initial task, delegate to two agents at once, route each reply once, expose failure, cancel delegated work, recover |
| Groups | Create a group, delegate a subtask, return its result to the parent task, remove a member, continue with remaining members |
| Routines | Create, edit, run manually, delegate child work, pause/resume, retain settings after restart, delete, execute a due schedule once |
| Generated content | Markdown, PDF, spreadsheet, PNG, and interactive HTML; open/reopen previews, download and compare file bytes, upload an attachment |
| Browser | Agent opens a real local page, fills a form, submits it, and checks the result; user opens the live page, reloads it, and returns control |
| User decisions | Accept/deny a command request and answer an agent question |
| Real providers | Codex, Claude, OpenCode, Grok, and Gemini each create a child, delegate browser work, receive its reply, and generate an attached file and interactive HTML |
| Real-provider MCP | Codex, Claude, OpenCode, Grok, and Gemini each discover and call custom HTTP and STDIO tools; one receipt per transport and both tool results in chat |
| Custom MCP | HTTP headers and STDIO arguments/environment; failed connection and retry, tool discovery, save/reload, one real agent tool receipt, disable/re-enable, removal, and host configuration isolation |
| Mixed providers | Codex assigns Claude, Claude assigns OpenCode, and results return through the group task chain |

Assertions check saved messages, task owners and parent links, unique replies, exact file bytes,
and HTTP form receipts. A provider's claim that it completed work is not sufficient. Live tasks
use explicit browser targets and wait for completed output before preview interaction.
Approval cases disable auto-approval for their test agent and check the exact provider decision;
the fixture performs a real workspace receipt write only after acceptance and checks that denial leaves no file. PDF coverage checks opening/reopening the
viewer and exact downloaded bytes; it does not inspect Chromium's native PDF rendering.

There are 24 scripted scenarios and 12 live scenarios per mode, plus three host-only scenarios:
75 required macOS cases. Linux runs the 51 scripted cases. The scripted CLI implements the Codex subprocess protocol.
It scripts model decisions; the app still executes tools, stores messages, schedules routines,
transfers files, and controls the embedded browser. Authentication and agent seed data use
supported application APIs. Host setup creates and accepts its invitation directly through the
local account API; production invitation links deliberately reject plain HTTP account origins.
The session token stays inside the Electron main process. The tested actions use UI controls. Native file dialogs are directed
to private test paths. Tests do not change IPC trust checks or disable the Electron sandbox.

Custom MCP cases use private local servers. Model decisions use the scripted provider, which
connects with the MCP SDK using the configuration the app sends to it. This checks configuration
delivery and real tool effects. Separate live cases check both transports with each real provider
CLI in local and host modes. OAuth sign-in is not covered.

The PDF test checks that its preview opens and its downloaded bytes match. It does not inspect
the native PDF viewer's rendered text. File fixtures are small and synthetic. The suite does not
publish sites or call paid image/video generation services.

## Mac mini setup

Use a dedicated macOS account with a logged-in graphical session and a GitHub Actions runner.
Keep personal provider credentials and personal OpenBot profiles out of that account. The runner
must have sufficient quota for three parallel workers and the child agents they create.

Set these repository variables:

| Variable | Value |
| --- | --- |
| `OPENBOT_E2E_RUNNER` | JSON array of the Mac mini's actual runner labels, for example `["self-hosted", "macOS", "ARM64", "openbot-e2e"]` |
| `OPENBOT_E2E_CODEX_MODEL` | Optional override; defaults to `gpt-6-luna` |
| `OPENBOT_E2E_CLAUDE_MODEL` | Optional override; defaults to `claude-haiku-5-5` |
| `OPENBOT_E2E_OPENCODE_MODEL` | Optional override; defaults to `opencode/muse-spark-1.3-contributor-free` |
| `OPENBOT_E2E_GROK_MODEL` | Optional override; defaults to `grok-4.6` |
| `OPENBOT_E2E_ANTIGRAVITY_MODEL` | Required Gemini model ID from the signed-in account's model list; no fallback |

Set these in the runner service environment:

- `OPENBOT_CODEX_PATH`, `OPENBOT_CLAUDE_PATH`, `OPENBOT_OPENCODE_PATH`, and `OPENBOT_GROK_PATH`: optional absolute
  paths to executable provider runtimes. The suite uses the app's installed CLI discovery by
  default. In CI, versions must match `native-runtime.lock.json` at the tested commit. Update
  this provisioned runtime cache when the lock changes. Local runs use the installed versions.
- `OPENBOT_ANTIGRAVITY_PATH`: required absolute path to Google's `agy_acp_server.par`.
  Keep the complete runtime bundle, including its harness, with the executable in `bin/` and
  `antigravity-package.json` (containing `version`) in the parent directory. The Antigravity
  editor command and Gemini CLI are not substitutes. The private test profile has no managed runtime.
- Dedicated Grok login state (`grok login`) or `XAI_API_KEY`, and completed Google sign-in for
  the Antigravity ACP server. Gemini uses the internal provider ID `antigravity`; the report
  names its case `live-gemini`. Both new providers run in local and host modes. Gemini host
  access requires Team API protocol 5 or later, which the current test apps support.
- Dedicated Codex and Claude login state, accessible to the runner account. `CODEX_HOME` and
  `CLAUDE_CONFIG_DIR` can point to the dedicated credential directories where supported by the
  provider. Complete login before starting the suite.
- `OPENCODE_API_KEY`: optional for a model that requires an OpenCode account key. The default
  free model needs no key. When set, the suite saves it through the app's provider settings API
  in each private profile.

The suite checks runtime versions and model availability. A missing model, expired login, or
failed provider turn fails the release; it does not substitute another provider or skip a case.
Do not print credentials or include them in workflow artifacts.

Protect `main` and release tags, and restrict access to the runner group and this workflow.
The hosted authorization job checks that the tested commit is an ancestor of `origin/main`
before the credential-bearing Mac mini job can start. It has read-only repository permissions.
One workflow run owns the Mac mini at a time. Do not add a pull-request trigger to this workflow.

The workflow installs the repository's Bun and Node versions and builds the app once. Linux uses
Xvfb and an AppArmor rule that permits Electron user namespaces. It keeps the Chromium sandbox.
Linux uses Electron's basic password store only for the temporary synthetic account sessions;
real-provider credentials are used only on the Mac mini. Functional tests use the repository's
Electron binary. Visual tests use the Playwright Chromium version installed by the macOS job.

## Commands and time budget

The complete release command builds the current code, installs the pinned Chromium browser,
runs all required Electron cases, then runs all six visual comparisons. It stops at the first
failed step and prints a final result. It removes inherited Electron runtime flags automatically.
It does not accept test filters or baseline-update options.
Release runs also require each of the six named visual cases to pass. A missing or skipped case
fails the command; `.openbot-build/visual/coverage.json` records the required-case result.

```sh
bun run test:e2e:release > run-logs.txt 2>&1
```

For focused functional runs, build the current commit first:

```sh
# Scripted local and host tests; one worker outside CI.
env -u ELECTRON_RUN_AS_NODE bun run test:e2e

# One focused test during development.
env -u ELECTRON_RUN_AS_NODE bun run test:e2e --project=local --grep='delegate delivers' --workers=1

# One case in both modes, in sequence.
env -u ELECTRON_RUN_AS_NODE bun run test:e2e --grep='delegate delivers' --workers=1

# Required real-provider cases only; uses provider quota.
env -u ELECTRON_RUN_AS_NODE bun run test:e2e:live

# One real provider's MCP case, in both modes, without other provider prerequisites.
OPENBOT_E2E_PROVIDER=codex env -u ELECTRON_RUN_AS_NODE bun run test:e2e:live --grep='live-mcp-codex ' --workers=1
# Use claude, opencode, grok, or antigravity for the other providers (Gemini case: live-mcp-gemini).
# OPENBOT_E2E_PROVIDER is rejected outside the live suite, including release runs.

# Discover tests without starting apps or services.
OPENBOT_E2E_SUITE=release bun run test:e2e --list --reporter=list
```

Keep broad builds and full suite runs in CI. For harness changes, run the focused
`scripts/electron-e2e.test.ts` test file and the Node typecheck. It checks real backend delegation,
group task resumption, cancellation/restart, and release-gate failures without starting Electron.

CI uses three Playwright workers on macOS and two on Linux. Each worker owns its profiles and
workspaces. Tests reuse the worker's app and use separate agents, group IDs, files, and browser
case IDs. Tests wait for state and events. Retries are disabled. The release reporter fails for
any missing, skipped, failed, or interrupted required case, or a test phase over ten minutes.
The Linux job sets `OPENBOT_E2E_SUITE=scripted-release` to require all 51 scripted cases without
requiring live providers. Ordinary `test:e2e` runs still permit selection of individual cases.
Dependency install, build, Chromium install, visual comparisons, provider preflight, and shared service startup are outside that budget.
Worker app startup and teardown are inside it. This budget still needs measurement on the Mac mini.

Do not run two suites in the same checkout at the same time: they share the report directory.
Tests create their own account database, Signal service, local browser page, and registry under
`.openbot-build/e2e/private-*`. They do not connect to production account services. Workspaces
stay inside the private profile. `OPENBOT_DEV_ISOLATED_WORKSPACES=1` only takes effect for an
unpackaged app with an explicit `--user-data-dir`.

## Evidence and cleanup

The suite writes `.openbot-build/e2e/report/coverage.json` and `index.html`. Each run replaces this report directory.
When reviewing cases separately, copy each report before starting the next case. A sequence of
focused passes does not verify the full parallel release time budget. The JSON includes
commit, platform, runtime versions, provider/model annotations, duration, and required coverage.
The report also retains the last 300 redacted log chunks. Failures save a UI screenshot. Playwright traces are disabled because Electron launch metadata
contains the inherited process environment. Text passes through the
shared secret redactor. Only `report/` is uploaded, for 14 days. Never upload the private profiles,
provider state, SQLite files, raw traces, or the entire `.openbot-build/e2e` directory.

Normal teardown stops owned processes and removes private state. If a worker exits before
teardown, the workflow runs:

```sh
bun tests/e2e/support/cleanup.ts
```

This command uses the existing development registry and PID identity checks. It only reads
registries under this checkout's private E2E directories. If process identity cannot be confirmed,
it fails and retains the registry and profile for inspection. Run it only after the suite stops.
Do not use process-name kill commands. A failure must be fixed before the next release attempt.

## Additional core coverage

- Delegation survives a client disconnect with one routed reply. Owner restart preserves delivery
  identity, marks uncertain work interrupted, and requires explicit recovery without replaying effects.
- Provider switches use the UI and keep the public agent/thread, message history, workspace and files.
- Concurrent conversations and local/host switches retain separate drafts, attachments and file effects.
- Provider errors and a real scripted CLI crash preserve submitted input and allow a later request.
- Uploaded content is read by the provider from the actual attachment path.
- Removing host membership through settings blocks stale scoped message and file requests.
- Agent creation selects a model through the UI; host recovery uses the connection retry control.
- Restart cases use Retry after the host is ready, so the normal offline retry delay does not slow the suite.
- Long history loads older messages and retains the reading position while another result arrives.

## Visual regression checks

`bun run test:visual` checks six fixed Storybook states: chat, streaming, approval, the delegation
menu, Markdown preview, and narrow chat. It uses the installed Playwright Chromium version and
starts or reuses only this worktree's registered Storybook instance. It stops an instance it starts.
No live provider or external account is used. The macOS release job requires these checks.

Expected screenshots are test fixtures under `src/renderer/stories/assets/visual-baselines/darwin`.
Missing baselines fail ordinary runs. To review an intentional layout change, run
`bun run test:visual --update-snapshots`, inspect every changed image, and commit the reviewed
fixtures. Do not update baselines automatically in release CI. Actual images, diffs and the HTML
report are under `.openbot-build/visual/`. Linux visual baselines are not included.
