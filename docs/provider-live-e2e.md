# Live provider test

`bun run test:provider-live` sends one real message to Codex, Claude and Gemini and waits
for the answer of each real model. It shows that a user of the desktop app can get a reply from each
provider. The provider fakes and the `Provider CLI canary` do not show this: they use no provider
account.

The runner is the [e2e](https://e2e.com/docs) framework. The files are in `scripts/provider-live/`.

## What a run does

1. `scripts/provider-live-e2e.ts` starts the local account service when this worktree has none,
   builds the desktop app, and runs `e2e run`.
2. e2e starts one app for each provider (`start-app.ts`), all at the same time. Each app has its own
   profile in `.openbot-build/provider-live/<provider>/profile` and its own DevTools port.
   `OPENBOT_PROVIDER_LIVE_DIR` names another folder for the profiles; CI sets it to a folder outside
   the checkout, because other jobs of the runner clean the checkout.
3. `provider-answers.e2e.ts` runs one time for each app. It waits until the provider is available,
   makes an agent on a low-cost model (`LIVE_MODELS` in `targets.ts`), types a message in the chat,
   and waits for the word that only the model can give. Then it deletes the agent.

The report is in `scripts/provider-live/.e2e/`: `report.json`, `summary.md`, `junit.xml`, the log of
each app, and for each test a `trace.md` with its screenshots.

```sh
bun run test:provider-live                      # all providers   
bun run test:provider-live --target=claude      # one provider; Gemini is `antigravity`
```

## What the computer must have

- A sign-in to each provider, made one time by the user who runs the test: Codex, Claude, Gemini.
  The test does not sign in. A provider with no sign-in fails its test with the state that the app
  reports.
- The provider CLIs are optional. The app downloads a CLI that is missing; the first run is then slower.

Each run sends two short messages to each provider and uses the subscription of the signed-in
account.

## How e2e drives Electron

e2e has no Electron engine. Its web engine connects to a browser on a DevTools address
(`web({ connect })`), and three parts of `start-app.ts` make the app fit it:

- **HTTP renderer.** The web engine opens only `http(s)` addresses, and the built app loads
  `openbot-app://`. The script serves `out/renderer` on loopback and gives the address to the app in
  `ELECTRON_RENDERER_URL`. The main process and the preload are the built ones.
- **Only the main window.** Electron cannot make a browser context, so the config sets
  `reconnectEndpoint`; e2e then uses the first page of the app. The app also has helper windows (the
  agent dock, the host bridge), and their order changes. `/__devtools` is the DevTools socket of the
  app without those windows.
- **Start is complete first.** e2e moves the window to `about:blank` when it connects. The app reads
  that as a failed start while its first load runs, so `/__ready` answers only after the load.

An app serves one attempt, so `retries` is 0. e2e's `agent.act` and `agent.assert` are not used:
they need a model of their own.

## The account

The app needs an account. It starts with `OPENBOT_DEV_REMOTE_ROLE=host`, which signs a development
account in on the local account service, as `bun run dev` does. Each app names its own account in
`OPENBOT_DEV_HOST_EMAIL` (`openbot-live-<provider>@example.com`), and the profile stays between runs
because it holds that sign-in: the account service permits 5 sign-ins for one email in 15 minutes,
with a wait of up to 60 seconds between two.

## In CI

The `Provider live E2E` workflow runs the test on the Mac mini runner (`runs-on: [self-hosted, macOS]`).
It runs only when a person with write access starts it (`workflow_dispatch`):

```sh
gh workflow run provider-live-e2e.yml --ref <branch> -f provider=all
```

Before a release, the [release-upgrade-safety](../.agents/skills/release-upgrade-safety/SKILL.md)
skill starts it on the pull request branch of the release (Step 2c), before the merge and the tag.

It has no provider secret: the providers use the sign-ins of the runner's user. It has no
`pull_request` trigger, because a pull request must not start its own code on a computer that holds
provider sign-ins.

## Add a provider

Add its id to `LIVE_PROVIDERS` and its model to `LIVE_MODELS` in `scripts/provider-live/targets.ts`,
and to the `provider` options of the workflow. e2e gets one more target and one more worker.
