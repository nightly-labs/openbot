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

## One channel list, one manifest, two mirrors

`src/ipc-channels.ts` declares every wire value. `src/ipc-endpoints.ts` gives that flat list its
structure: which group each channel belongs to, and whether it is a **request** the renderer invokes
or an **event** the main process sends. Nothing else in the repository decides those two facts.

A type-level assertion at the bottom of `ipc-endpoints.ts` holds the two files together. Add a
channel to `IPC_CHANNELS` and leave it out of every group and the `IpcEndpoints` declaration fails
with the channel in the diagnostic:

```
error TS2344: Type '{ channelsMissingFromEveryGroup: "app:brand-new-thing"; }'
  does not satisfy the constraint 'true'.
```

It costs nothing at runtime. There is no generator, no committed output and no check to remember to
run — `bun run typecheck` already runs it.

Two files still mirror the list by hand, and they are not enforced the same way.

| Mirror | What it is | What holds it |
| --- | --- | --- |
| `src/preload/index.ts` | the `invoke` calls the renderer actually reaches | `src/main/ipc-channel-coverage.test.ts` |
| `src/renderer/src/preview/mock-openbot.ts` | the second implementation Storybook and the preview run against | `tsc`, against `OpenBotDesktopApi` |

The main process is no longer one of them. `registerIpcGroups` in `src/main/ipc/define-ipc-group.ts`
takes one object per group, keyed by every request endpoint in it, so a channel with no handler is
`TS2741`, a handler for an endpoint that does not exist is `TS2353`, and a group no registrar covers
is `TS2741` at `src/main/index.ts`. `src/main/AGENTS.md` has the shape to copy.

The preload is the link no type reaches. Its API object is shaped for the renderer — nested, renamed,
decoding results — so nothing pairs a method with an endpoint, and a channel it never invokes is dead
trust-boundary surface that compiles. `ipc-channel-coverage.test.ts` reads its source and asserts it
invokes exactly the request endpoints and subscribes to exactly the event ones.

The mock needs no test. Both it and the preload bridge are annotated `: OpenBotDesktopApi`, so a
missing method is `TS2741` and a method the interface never declared is `TS2353` — the type checker
already covers both directions, and under Tests rule 3 that is the end of it. What it cannot cover is
the *behaviour*: `mock-openbot.ts` is a product surface, not a test double, and it is what the preview
and every Storybook story exercise. A method that satisfies the type by returning an empty array is a
story that silently shows nothing.

Adding a channel means `ipc-channels.ts`, `ipc-endpoints.ts`, its registrar, the preload and the mock
in the same change. You do not have to remember that list: add the channel, run `bun run typecheck`,
and every step but the preload names itself.
