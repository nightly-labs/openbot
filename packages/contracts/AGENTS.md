# `packages/contracts`

The IPC channel list, the IPC payload types, and the frozen Team API wire protocol. Everything here
is a contract someone else already implements — a shipped desktop build, a remote host, a renderer
mock — so the cost of a change is paid by code you cannot edit.

## Team API protocol compatibility

- Never use the application SemVer as a wire protocol version; application versions are diagnostic
  metadata only.
- Keep a frozen codec, adapter, and client and host fixtures for each released protocol under
  `src/team-protocol`, and one registered adapter per supported protocol. Do not serialize current
  IPC types across the boundary.
- Use capabilities for additive, optional behaviour; a missing capability disables only its own
  feature.
- A required field, a removed field, or a semantic change needs a new protocol version. Never change
  the meaning of a released one.
- Age, release count and SemVer distance are not reasons to remove an adapter. Removal needs a
  separate architecture decision — a security issue, data-loss risk, semantics that cannot be kept,
  or cost an adapter cannot contain — plus a changelog entry, update instructions, both
  update-direction tests, and clear UI text.
- Malformed known payloads fail closed as `protocol_error`. Unknown optional events are ignored.

## One channel list, two mirrors

`src/ipc-endpoints.ts` declares every endpoint in `IPC_ENDPOINTS`: its wire value, its group,
and whether it is a **request** the renderer invokes or an **event** the main process sends.
Nothing else in the repository decides those facts. Main and the preload pass the endpoint object,
such as `IPC_ENDPOINTS.auth.event`, and read `.channel` from it; they do not write a wire value.
`ipc-channel-coverage.test.ts` fails when two endpoints share one wire value.

Two files still mirror the list, and they are not enforced the same way.

| Mirror | What it is | What holds it |
| --- | --- | --- |
| `src/preload/index.ts`, bridged groups | one `bridgeGroup(IPC_ENDPOINTS.group, decoders)` per group; the decoder map is keyed by every endpoint | `tsc` (`TS2741` / `TS2353`), and the coverage test for the group reference |
| `src/preload/index.ts`, hand-written groups | the `invokeRequest` and `subscribe` calls the renderer actually reaches | `src/main/ipc-channel-coverage.test.ts` |
| `src/renderer/src/preview/mock-openbot.ts` | the second implementation Storybook and the preview run against | `tsc`, against `OpenBotDesktopApi` |

The main process is no longer one of them. `registerIpcGroups` in `src/main/ipc/define-ipc-group.ts`
takes one object per group, keyed by every request endpoint in it, so a channel with no handler is
`TS2741`, a handler for an endpoint that does not exist is `TS2353`, and a group no registrar covers
is `TS2741` at `src/main/index.ts`. `src/main/AGENTS.md` has the shape to copy.

A typed endpoint (`request<Payload, Result>()`, `event<Payload>()`) also sets the renderer
signature. Declare its `OpenBotDesktopApi` method as `Invoke<typeof IPC_ENDPOINTS.group.name>` or
`Subscribe<...>`. Then a payload or result change in `ipc-endpoints.ts` reaches the interface, the
preload and the mock without a second edit. Declare a server-scoped endpoint with
`scopedRequest<Input, Result>()` or, when it carries only the server, `scopedQuery<Result>()`;
`request` does not compile with an `AgentIpcRequest` payload. Main receives
`AgentIpcRequest<Input>`. The renderer signature is `(input: Input, serverId?: string)`, or
`(serverId?: string)`, because the preload builds the scope and uses the selected server when the
caller names none. Pass `"required"` as the last type argument when a caller must always name the
server, such as a settings panel that can show a server the user has not switched to. Write the
signature by hand only when the method reshapes its arguments or reads preload state, or for
`browser.sendLiveViewInput`, the one untyped endpoint.

A group whose methods all pass straight through is generated whole: `GroupApi<IpcEndpoints["group"]>`
gives its interface, a request keeps its key, and an event is `on` and the key (`voice.modelStatus`
is `onModelStatus`). The preload builds it with `bridgeGroup` and the test harness with `stubGroup`,
so a new endpoint in it needs no line in `ipc-desktop-apis.ts`. `app` and `providers` are spread into
the top level. There are no per-method overrides: a group that needs one is written by hand. These
stay by hand: `computerUse` (renamed top-level members), `browser` (the untyped endpoint and renamed
members), `auth` (`verifyEmailCode` reshapes its arguments), `servers` (preload state, and member and
invite calls that take the server first), and `attachmentImports`, which only the preload calls with
the paths of dropped files and which the renderer must never reach. The eight agent groups are spread
into `agent`, so their keys are the renderer names (`agent.listAgents`, `mcpServers.saveMcpServer`).

In a hand-written group the preload is still the link no type pairs with an endpoint. Its API object
is nested and renamed, so a channel it never invokes is dead trust-boundary surface that compiles.
`ipc-channel-coverage.test.ts` reads the preload sources and asserts they invoke exactly the request
endpoints and subscribe to exactly the event ones, counting a bridged group as all of its endpoints.

The mock needs no test. Both it and the preload bridge are annotated `: OpenBotDesktopApi`, so a
missing method is `TS2741` and a method the interface never declared is `TS2353` — the type checker
already covers both directions, and the root Tests rule against assertions that TypeScript already
enforces ends it there. What it cannot cover is
the *behaviour*: `mock-openbot.ts` is a product surface, not a test double, and it is what the preview
and every Storybook story exercise. A method that satisfies the type by returning an empty array is a
story that silently shows nothing.

Adding a channel means `ipc-endpoints.ts`, its registrar, the preload and the mock in the same
change. You do not have to remember that list: add the channel, and
`bun run typecheck:node` and `bun run typecheck:renderer` name every step but the preload call of a
hand-written group.
