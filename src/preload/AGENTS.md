# `src/preload`

The preload is the only code that runs with both `ipcRenderer` and renderer access. It is part of the
renderer-to-main trust boundary. [Main-process rules](../main/AGENTS.md#trust-boundary) apply here.

- `index.ts` maps each `OpenBotDesktopApi` method to one IPC channel and exposes the result with
  `contextBridge.exposeInMainWorld`. Add no business rules here.
- Decode each value that main sends before the renderer can read it. Keep the preload `FromMain`
  decoders apart from the main `FromHost` decoders. They protect different boundaries.
- Invoke only request endpoints from `IPC_ENDPOINTS`, and subscribe only to event endpoints.
  `src/main/ipc-channel-coverage.test.ts` reads this source and fails on an unused or extra channel.
- Do not expose `ipcRenderer`, Electron objects, or Node APIs to the page. `team-webrtc.ts` gives
  the hidden WebRTC window only one `MessagePort`.
- Add a method in the same change as its channel, handler, and preview mock. See
  [IPC binding rules](../main/ipc/AGENTS.md#adding-an-endpoint).
- Keep the sandbox and context isolation. The remote browser session has no preload and no
  `window.openbot`.

Run one test file: `bun run test:desktop -- src/preload/<name>.test.ts`. For a channel change, also
run `bun run test:desktop -- src/main/ipc-channel-coverage.test.ts`.
