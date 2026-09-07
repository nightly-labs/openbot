# Main-process design notes

[The main-process instructions](../src/main/AGENTS.md) contain the active rules and file ownership
map. This document explains the decisions and the failures that led to them.

## IPC coverage and privileged imports

The main process runs with the user's full privileges. Agents already use `danger-full-access`;
Electron sandboxing, context isolation, navigation policy and sender validation protect the process
boundary that remains. A renderer feature must be assessed as a capability available to a
compromised renderer.

IPC domain modules return typed handler groups. Missing endpoints produce `TS2741`; extra endpoint
names produce `TS2353`. Missing groups in `registerIpcGroups` also produce `TS2741`. This replaced a
source scan that found modules which the dispatcher did not call. Removing both a registrar import
and its spread now fails compilation.

The payload binding types make `(input: unknown) => Result` incompatible with the no-payload
`() => Result` form. This requires an explicit decoder. Decoding follows sender validation so an
untrusted frame cannot reach a parser.

`ipc-channel-coverage.test.ts` restricts the name `ipcMain` to `ipc/define-ipc-group.ts`. An aliased
import elsewhere could otherwise register a handler without a sender check. The test restricts the
trusted wrapper names to that file too: the wrappers accept string channels, so direct use could
create an endpoint outside the declared groups. Direct `IPC_CHANNELS.x` references keep renderer
sends visible to the same coverage checks.

`index.ts` calls `app.setPath`, `app.enableSandbox` and
`protocol.registerSchemesAsPrivileged` at module scope. Tests that import it need an Electron mock.
Source coverage tests read the file instead. A service without an Electron dependency can use
ordinary unit tests; an unnecessary import would force it into the Electron mock setup.

## Test harnesses

The remote-server suite once had eight separate socket fakes. Five declared `readonly readyState`,
so closing the fake left it OPEN. The event stream's two `readyState !== WebSocket.OPEN` guards
could not run in the tests that appeared to cover them. `FakeEventSocket` in
`remote-server-test-harness.ts` now models that transition in one place. The harness is a plain
`.ts` module with no test cases, like `src/backend/agent-service-test-harness.ts`.

Remote-server modules each have a matching test file. The backend's `agent-service.*.test.ts`
pattern splits tests of one large class and is not the model for this module family.

`TeamApiServer` is different: its cases call routes through real HTTP listeners. Route domains are
the useful test boundary, so `team-api-server.*.test.ts` follows that split. Its shared harness
requires explicit choices where defaults would change what a case tests. `host-service.test.ts`
was separated because those cases test another class.

Service events, returned promises, listener callbacks and harness barriers identify the state a
test needs. `waitForServer` reports differences against the complete server summary.
`deferredRoute` separates request arrival from its response. Fixed elapsed time cannot provide
those guarantees under runner load. Use fake timers for behavior whose input is elapsed time.

## Construction and shutdown

Service construction, windows, saved bounds, shutdown, development remote setup, session
configuration, renderer event forwarding and IPC handlers moved out of `index.ts`. The file keeps
lifecycle and dispatch work.

`createApplicationServices` remains one function because control-flow narrowing makes construction
order explicit: a service assigned to a `const` can satisfy later non-null constructor parameters.
Splitting it into stages would pass a roughly 15-field object between stages and restore ordering
hazards. It only constructs. Adding event wiring would require more inputs than outputs and invert
the dependency direction.

Shutdown is largely in construction order, rather than reverse order. The browser host closes
before its picture-in-picture window. Provider runtimes stop before the agent service that owns
them. Teardown ordinals state this order beside construction instead of repeating it elsewhere.

Dependencies wired before `app.whenReady()` need getters because the services do not yet exist.
Capturing `null` there never recovers. The renderer forwarders and window module now read one
service handle each instead of eleven separate handles. Code wired during construction can receive
values directly. Both a getter and a nullable value can type-check, so the compiler cannot select
the correct lifetime.

A similar lifetime issue applies to windows: a constructor needs the current window, but a callback
that runs later must obtain it again. macOS can close and rebuild the main window without ending
the application.

## Remote services and released protocols

`remote-server-manager.ts` was 2,828 lines before its concerns moved to the flat `remote-server-*`
and `remote-*-decoding` family. The manager connects those modules through callbacks. The request
path does not need to know about the event stream, and the event stream does not need to know about
the error path. The callback connection preserves those dependency boundaries.

Team API routes use the same narrow dependency style as IPC handlers. Four behavior rules explain
the dispatch order:

- Compatibility runs first so an old client can read how to update instead of receiving 426 on
  every request.
- Remote-screen delegation precedes the protocol gate because a browser that loads the viewer
  sends no protocol header or token.
- Authentication precedes route selection so an unknown path without a token returns 401.
- The dispatcher handles unmatched paths and methods. Released clients receive 404 for a wrong
  method on a known path.

One dispatcher catch keeps unexpected errors visible to the logger and returns 500. A local catch
could incorrectly convert them to 400. There is one `HttpError` class because `instanceof` would
not recognize a second definition and would turn an intended 400 into 500.

The explicit `Promise<RouteOutcome>` return annotation produces `TS2366` when a route falls off the
end. This project has no `noImplicitReturns` guard. Without the annotation, inference can accept
`undefined`, which becomes a silent 404.

Host and preload decoders remain separate because they validate different trust boundaries. HTTPS
V1/V3 and WebRTC V2 remain separate because their encodings are released contracts. Control-plane
methods remain on `RemoteTeamDirectory` because they contact a different server from the host.

`ipc-channel-coverage.test.ts` checks a name bijection between `decode*FromHost` under `src/main`
and `decode*FromMain` in the preload. This prevents deleting one side and redirecting its callers
to the other, which could apply trusted-main validation to a remote server. The test only checks
names: review must still detect two names that refer to one decoder.
