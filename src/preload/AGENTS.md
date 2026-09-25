# `src/preload`

The preload is the only code that runs with both `ipcRenderer` and renderer access. It is part of the
renderer-to-main trust boundary. [Main-process rules](../main/AGENTS.md#trust-boundary) apply here.

- `index.ts` maps each `OpenBotDesktopApi` method to one IPC channel and exposes the result with
  `contextBridge.exposeInMainWorld`. Add no business rules here.
- Decode each value that main sends before the renderer can read it. Put decoders in the
  `*-decoding.ts` file for their domain, not in `index.ts`. Keep the preload `FromMain` decoders
  apart from the main `FromHost` decoders. They protect different boundaries.
- Build a group whose methods pass straight through with `bridgeGroup(IPC_ENDPOINTS.group, decoders)`.
  Pass the group directly, with no explicit type arguments, so the decoder map is checked against
  every endpoint. A request's decoder decodes its result; an event's decoder decodes its payload, or
  `dropInvalid(decode)` drops a value that answers null (for a deep-link id). A group is bridged
  whole or written by hand; do not add a direct call for one endpoint of a bridged group. A bridged
  method forwards only its first argument, so main still sees at most one payload. It also forwards
  an argument that a no-payload method gets. A scoped endpoint (`scopedRequest`, `scopedQuery`) is
  sent as `AgentIpcRequest`: the server is the argument after the payload, or the selected server,
  read at call time. Do not pass a bridged method by reference as an event handler, such as
  `onClick={api.update.check}`: Electron cannot copy the DOM event, and the call rejects.
- Only `attachmentImports` and the untyped `browserInput` are written by hand. Invoke through
  `invokeAgentForServer`, or `ipcRenderer.invoke` for the untyped endpoint. Subscribe through
  `listen` and decode the raw value in the handler. Do not call `ipcRenderer.on` directly.
- Invoke only request endpoints from `IPC_ENDPOINTS`, and subscribe only to event endpoints.
  `src/main/ipc-channel-coverage.test.ts` reads these sources and fails on an unused or extra channel.
- Do not expose `ipcRenderer`, Electron objects, or Node APIs to the page. `team-webrtc.ts` gives
  the hidden WebRTC window only one `MessagePort`.
- Add a method in the same change as its channel, handler, and preview mock. See
  [IPC binding rules](../main/ipc/AGENTS.md#adding-an-endpoint).
- Keep the sandbox and context isolation. The remote browser session has no preload and no
  `window.openbot`.

- `scripts/verify-preload-bundle.ts` runs the built bundle and compares `window.openbot` with
  `IPC_ENDPOINTS`. A new endpoint group needs a place in its `GROUP_PATHS`, and a method written by
  hand needs an entry in `HAND_WRITTEN_METHODS`. CI runs it after the build in `check:desktop:static`.

Run one test file: `bun run test:desktop -- src/preload/<name>.test.ts`. For a channel change, also
run `bun run test:desktop -- src/main/ipc-channel-coverage.test.ts`.
