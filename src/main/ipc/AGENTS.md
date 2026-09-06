# `src/main/ipc`

One file per domain, each exporting a `*IpcHandlers` function that returns its handlers. Nothing
here registers anything: `index.ts` spreads them all into `registerIpcGroups`, which walks
`IPC_ENDPOINTS` and binds each request endpoint to the handler under its own name.

## Adding an endpoint

1. Add the wire value to `packages/contracts/src/ipc-channels.ts`.
2. Add it to a group in `packages/contracts/src/ipc-endpoints.ts`, as `request(...)` or `event(...)`.
3. Run `bun run typecheck`. It now names the file to change and the key to add.
4. Add the handler here, the `invoke` in `src/preload/index.ts`, and the method in
   `src/renderer/src/preview/mock-openbot.ts`.

Step 3 is the point. Every step but the preload announces itself, and the preload is what
`src/main/ipc-channel-coverage.test.ts` reads.

A group is the unit one registrar covers in full, which is why a wire prefix can span several: the
`agent:` channels are four groups, one per registrar, because the exhaustiveness a group buys is only
worth having when a single object literal can satisfy it. A registrar covering more than one group
returns `Pick<IpcGroupHandlers, "servers" | "host" | "remoteDesktop">`.

## The four ways to bind a handler

From `./define-ipc-group.ts`. Pick by what the implementation needs; there is no other way in, and
none of them lets a payload through undecoded.

| Constructor | For |
| --- | --- |
| `handler(fn)` | takes nothing the renderer sent |
| `payloadHandler(decode, fn)` | takes a payload — `decode` is what makes it a known shape |
| `eventHandler(fn)` | needs the `IpcMainInvokeEvent`, for `event.sender` or the window behind it |
| `authorizedHandler(authorize, decode, fn)` | needs a sender-identity check *before* anything is decoded |

There is deliberately no unauthorized event-plus-payload constructor: every endpoint that needs both
today needs the sender check too. `handleTrustedWithEvent` carries the overload, so add the
constructor when an endpoint actually wants it rather than before.

`authorizedHandler` exists because every window of the app shares one origin, so the trusted-URL gate
in `./trusted-ipc.ts` cannot tell the Dynamic Island overlay from the main renderer.
`dynamic-island-handlers.ts` is the only user today, and the ordering is the point: a caller already
known to be rejected must not be handed a payload-validation error to read, and must not be what the
decoder spends its allocations on.

## What is enforced, and by what

| Rule | Enforced by |
| --- | --- |
| every declared channel belongs to a group | the `IpcEndpoints` declaration in `ipc-endpoints.ts` (`TS2344`) |
| every request endpoint has exactly one handler | `GroupHandlers` (`TS2741` / `TS2353`) |
| every group has a registrar | `registerIpcGroups` at `src/main/index.ts` (`TS2741`) |
| no handler binds a channel outside the manifest | both entry points here read `IPC_ENDPOINTS` and take a group *name*; `ipc-channel-coverage.test.ts` keeps the wrappers unreachable elsewhere |
| a payload is decoded before the handler sees it | no constructor pairs one with a raw `unknown` |
| no channel is in two groups | `ipc-channel-coverage.test.ts` |
| the preload invokes exactly the request endpoints | `ipc-channel-coverage.test.ts` |
| the sender check runs first | `trusted-ipc.test.ts`, `define-ipc-group.test.ts` |

Prefer breaking the type over adding a test. Most of these cost nothing to run and name the thing
that is wrong; the ones that read source text exist only where no type reaches.

## Routing

A handler that takes a `serverId` serves two backends — the local `AgentService` or a remote team
server over HTTP — and picks with `routeToServer(serverId, { local, remote })` from
`./route-to-server.ts`. Write the branch out by hand and you have written the fifty-fifth copy of the
same ternary.
