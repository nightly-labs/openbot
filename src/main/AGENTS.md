# `src/main`

The Electron main process owns the trust boundary, windows, lifecycle and privileged services.
Check each change for what a compromised renderer could do with it.

For rationale and module history, see
[main-process design notes](../../docs/main-process-design-notes.md).

## IPC endpoints

- Declare endpoints in `packages/contracts/src/ipc-channels.ts` and `ipc-endpoints.ts`. Implement them
  in `src/main/ipc/`, one file per domain. Do not put handlers in `index.ts`.
- Follow `ipc/team-handlers.ts`: a `*IpcDependencies` interface, destructured dependencies, a
  `*IpcHandlers` function that returns handlers keyed by endpoint name, and a
  `Pick<IpcGroupHandlers, …>` return type. Do not import from `index.ts`.
- `registerIpcHandlers` in `index.ts` only supplies dependencies and passes all groups to
  `registerIpcGroups`. The declared types check endpoint and group coverage; do not add a test for
  this type check. Read [IPC binding rules](ipc/AGENTS.md) for the four handler forms.
- `handleTrusted` and `handleTrustedWithEvent` from `trusted-ipc.ts` are the only registration
  primitives. Only `ipc/define-ipc-group.ts` may call them or use `ipcMain`.
- Parse every argument with `payloadHandler(decode, handler)`. Use `ipc/validation.ts` primitives
  (`requireString`, `stringPayload`, `optionalPayload`, `nullishPayload`, `isObject`) and domain
  `*-inputs.ts` parsers. The sender check must run before decoding. Do not bind raw `unknown` as a
  no-payload handler.
- Use `sendToRenderer` from `renderer-ipc.ts` to send messages. It drops messages for destroyed or
  loading windows. Its channel argument must be a direct `IPC_CHANNELS.x` reference; do not use a
  string literal or an intermediate variable. Handlers do not name channels; groups do.
- Add a channel in one change across `ipc-channels.ts`, `ipc-endpoints.ts`, `src/main/ipc/`,
  `src/preload/index.ts` and `src/renderer/src/preview/mock-openbot.ts`. See
  [contract rules](../../packages/contracts/AGENTS.md) for coverage, including the untyped preload.

## Trust boundary

Sandboxing, context isolation, navigation policy, IPC sender validation and their tests are
non-negotiable. Changes to `trusted-renderer.ts` (origins), `renderer-permissions.ts` (permissions)
or `content-security-policy.ts` (loaded content) need tests. Treat changes to
`isTrustedRendererUrl`, including development use, as security boundary changes.

Do not import across the renderer/main boundary. Biome checks `src/main`, `src/backend` and
`src/preload` against renderer imports, and checks the reverse direction. Main may import backend.
Put shared types in `packages/contracts`.

Keep these implementations separate:

- `FromHost` decoders and preload `FromMain` decoders: they protect different trust boundaries.
  Add each decoder to both sides. `ipc-channel-coverage.test.ts` checks matching names; review must
  also check that the two names do not share one decoder.
- HTTPS V1/V3 and WebRTC V2 encodings: these are released wire protocols.
- `RemoteTeamDirectory` control-plane methods: these contact a different server from the host.

## Tests

Wait on observable conditions, not fixed delays. A fixed delay is valid only as test input, such as
configured latency. Use these existing barriers:

| Situation | Barrier |
| --- | --- |
| Service status | Its emitter; see `waitFor(manager, predicate)` in `provider-runtime-manager.test.ts` |
| Handler completion | Its returned promise, including listeners captured from `handleTrusted` |
| Spy call without an event | `await vi.waitFor(() => expect(spy).toHaveBeenCalledOnce())` |
| Server ready | `await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))` |
| Debounce, backoff or polling | `vi.useFakeTimers()` and advance the timers |
| Remote server state | `waitForServer(fixture, { state: "online" })` from `remote-server-test-harness.ts` |
| Remote request arrival | `deferredRoute()` from that harness; await `route.arrived`, then use `route.resolve(...)` |

Use `remote-server-test-harness.ts` before writing WebSocket or `fetch` fakes for `remote-server-*`.
Pair `foo.ts` with `foo.test.ts`. Keep `team-api-server.*.test.ts` split by route domain: these tests
use real HTTP listeners. Use `team-api-server-test-harness.ts` and read its header for required
explicit fixture choices. Tests for `HostService` belong in `host-service.test.ts`.

Tests that import Electron code must mock `electron`. Follow `trusted-ipc.test.ts`: use
`vi.hoisted` for a registrations `Map`, capture listeners with `vi.mock("electron")`, and invoke them
with a fabricated sender frame. Services that can be tested without Electron should not import it.
`index.ts` has module-scope Electron calls; source coverage tests read it instead of importing it.

## Ownership and lifecycle

Keep `index.ts` as the dispatcher and lifecycle module. Do not move these responsibilities into it:

| File | Owner of |
| --- | --- |
| `application-services.ts` | Service construction in dependency order |
| `main-window.ts` | Every `BrowserWindow`, renderer URLs, menu, bounds recorder |
| `main-window-state.ts` | Reading, resolving and debounce-writing saved window position |
| `teardown-registry.ts` | Shutdown sequence |
| `development-remote-bootstrap.ts` | Dev-only `OPENBOT_DEV_REMOTE_ROLE` account and connection |
| `session-configuration.ts` | Renderer CSP, bundle protocol, permissions, attachment/avatar/logo protocols |
| `renderer-forwarders.ts` | Service events sent to the renderer |
| `ipc/*-handlers.ts` | IPC endpoints by domain |

Keep `createApplicationServices` as one function that only constructs services. Event wiring,
`registerIpcHandlers`, `loadRenderer` and `app.on("activate")` stay in `index.ts`. Register each
service teardown beside its construction, with an explicit ordinal. Do not infer shutdown order
from construction order or reverse it.

Dependencies wired at module scope before `app.whenReady()` must be getters, such as
`getAgentService: () => AgentService | null`, read on each call. This applies to
`renderer-forwarders.ts` and `main-window.ts`. Dependencies wired inside `application-services.ts`
take values, including protocol services and IPC stores. Constructor arguments take the current
window; callbacks that run later must read `getMainWindow()` again.

`remote-server-manager.ts` owns the IPC surface and connects its modules through callbacks. Keep
new concerns in the matching module below, or a new sibling. Do not connect the request, event or
error paths by importing each other.

| Concern | Files |
| --- | --- |
| Stored server list and schema | `remote-server-store.ts`, `remote-server-stored-shape.ts` |
| Team API requests | `remote-server-client.ts`, `remote-server-http.ts`, `remote-server-errors.ts` |
| User-visible connection failures | `remote-server-connection-status.ts`, `remote-server-connections.ts` |
| Events and reconnects | `remote-server-event-stream.ts`, `remote-server-event-refresh.ts` |
| Team directory, presence, host reconciliation | `remote-team-directory.ts`, `remote-server-presence.ts`, `remote-server-host-directory.ts` |
| Host payload decoding | `remote-host-decoding.ts` and its four wire-area siblings |

## Team API routes

`team-api-server.ts` keeps the class, WebSocket handling and lifecycle. Routes live in `team-api/`,
one file per domain. Each exports `route*(context, deps)` with narrow `*RouteDependencies` and an
explicit `Promise<RouteOutcome>` return type. Finish each route with `return "unmatched"`; the
return type enforces this without a test.

| Concern | Files in `team-api/` |
| --- | --- |
| Shared error, dependencies, parsing, context | `http-error.ts`, `dependencies.ts`, `request-helpers.ts`, `request-context.ts` |
| Members, invitations, sessions, presence, authenticated account routes | `route-team.ts` |
| Screen, direct requests, browser, files | `route-remote-screen.ts`, `route-direct.ts`, `route-browser.ts`, `route-files.ts` |
| Agent collection and the only `/v1/agents/:agentId` regex | `route-agents.ts` |
| Agent sub-resources, owned by `route-agents.ts` | `route-agent-memories.ts`, `route-agent-routines.ts`, `route-agent-conversation.ts`, `route-agent-queue.ts` |

Preserve these released wire rules:

- Run gates in order: `compatibility`, remote-screen delegation, protocol gate, path-independent 401.
- Only the dispatcher returns 404. An unsupported path **or method** returns `"unmatched"` from the
  route; a wrong method stays 404, not 405.
- Only the dispatcher catches errors. Unexpected errors must reach the logger and return 500.
- Define `HttpError` only in `http-error.ts`; classification uses `instanceof`.
