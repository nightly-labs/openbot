# Computer Use and remote desktop

## Computer Use

Computer Use is `cua-driver`, a third-party MIT binary, and OpenBot owns how it runs.
`cua-driver-runtime.ts` in the main process starts one long-lived `serve` daemon and holds it; each
provider CLI spawns its own short-lived `cua-driver mcp --socket` proxy against that daemon. All
screen capture, accessibility reads, and input posting happen inside the daemon, so the proxy's own
identity does not matter.

The daemon is spawned directly, and never through `open(1)` or `NSWorkspace`. macOS finds the
responsible process by walking up the launch chain, so a direct spawn puts OpenBot at the top of it
and the user grants Screen Recording and Accessibility to OpenBot rather than to somebody else's
helper. `CUA_DRIVER_EMBEDDED=1` tells the driver to stay on that path instead of relaunching itself
as its own application. Anything that launches the daemon another way breaks the attribution, which
is the reason the earlier Codex helper was replaced.

Startup calls `warmUp()`, which reads the state once and keeps the daemon only when both grants are
there. A user who granted them keeps the tools after a restart, and a remote request or a scheduled
task — neither of which opens a window — reaches them too. A user who granted nothing keeps no
process, and no prompt is raised either way: only using the driver asks for a grant. Every other
start is lazy, on a state read from the panel.

The control socket lives in the private per-user runtime directory, mode `0o700`, not in `/tmp`:
whoever reaches it can drive the whole desktop. It cannot live under `userData`, because
`sockaddr_un.sun_path` holds 104 bytes on macOS and an isolated development profile spends most of
them on the worktree hash. Windows uses a named pipe, which has no such limit; its name is random,
because Windows lets a second process add an instance to a name it can guess, and it is kept in the
profile so that it is random once rather than once per launch. The endpoint has to hold still: it
reaches each proxy as an argument, and the arguments are folded into the stored Codex tool
fingerprint, so a name that moves at each launch replaces every session after a restart. The command
has to hold still for the same reason: the packaged Linux build is an AppImage, whose resources are
mounted somewhere else at each launch, so there the proxies are given a link below the profile that
the runtime points at this run's driver.

One MCP entry reaches every provider. `CuaDriverRuntime.mcpServerConfig()` returns a config only
while the daemon runs, and `AgentService.enabledMcpServers()` appends it, which is the one function
Codex, Claude, and ACP all read. Two properties keep it there: the name is not in
`RESERVED_MCP_SERVER_NAMES`, which is a drop filter rather than a marker, and `workingDirectory`
stays empty, because ACP has no field for one and Codex accepts none, so an entry with one would
vanish for two providers with no error. Codex staleness needs no separate signal, because
`toolFingerprint` already folds the MCP entries and a changed fingerprint forces a replacement
session. `onMcpServerChanged` is what refreshes the agent runtimes, which deactivates every
stored provider session: the next turn starts a new one, which keeps the public thread and loses
what the provider held privately. So it reports two moments only — the entry appearing on a start a
user asked for, and the daemon dying under OpenBot. It is quiet for a grant given while the daemon
serves, which changes the state and not the tool set; for the startup warm-up, which settles the
entry the stored sessions already had; and for the stop at teardown, which happens at order 55,
before the agent service at 110, and would otherwise deactivate on every quit the sessions the next
run is meant to resume.

`capabilities.computerUse` is pushed by main from the daemon's own permission answer. It is no
longer probed from Codex `plugin/list`, which is why the capability now reports the same state for
every provider.

The driver is packaged, not downloaded on demand, so it is pinned in `native-runtime.lock.json` like
the other native runtimes rather than managed like a provider CLI. The pinned file list is an
allowlist: `scripts/install-cua-driver.ts` copies only the named paths and checks each digest, so an
upstream layout change fails the build instead of shipping a surprise file. Each installer carries
only its own target. On macOS `mac.signIgnore` keeps the vendor's Developer ID signature, because
re-signing under OpenBot's inherited entitlements would drop the Automation entitlement the driver
needs. A packaged build reads the copy under `resources/cua-driver` and nothing else, because the release
is pinned and signed against that build and an environment variable must not decide which program
drives the user's desktop; a release without the binary reports no driver. In a checkout
`resolveCuaDriver` also reads an override, an install directory and `PATH`, so a developer can point
`OPENBOT_CUA_DRIVER_PATH` at another build.

OpenBot draws the agent cursor in its own per-display overlays for every display layout. The
runtime starts `serve` with `--no-overlay`. The driver's overlay covers only the main display and
cannot follow a display connected after startup. Keeping cursor ownership in OpenBot lets the
highlight controller add, resize, and remove display overlays without restarting the daemon or
changing provider sessions.

Because the driver draws no cursor, its motion styles do not apply. The renderer plays the driver's
`adaptive` style itself (`agent-cursor-motion.ts`, a port of the driver's `trajectory.rs`): a Fitts
min-jerk glide, or a wide swoop for a move over 900 points. The tap does not delay a request, so the
cursor shows where an action went, from 180 ms to about 1.1 s after the driver acts.

Every copy OpenBot starts gets `CUA_DRIVER_RS_TELEMETRY_ENABLED=0` and
`CUA_DRIVER_RS_UPDATE_CHECK=0`. OpenBot ships the driver, so its vendor analytics are not something
a user chose, and OpenBot pins the version, so a release check could only offer an update OpenBot
would refuse.

## Remote desktop permission checks and live tests

`RemoteScreenGateway` owns setup checks and live-test session ownership. The optional
`remote-desktop-setup` Team API capability uses separate v4 adapter routes; released codecs remain unchanged.
Diagnostics contain host/account names and permission results and travel only to an authenticated member.
They do not include Sunshine credentials or screen content. The renderer opens macOS settings only through
fixed local IPC actions.

Sunshine checks its own macOS permissions and hosts the temporary native test panel. During a test, native
input is restricted to that panel and tagged for the test. The panel requires both the test tag and the
Sunshine process ID before recording a click or keyboard result. The gateway rejects additional sessions
and display switches during a test and closes the panel when its owning stream disconnects. It does not
interrupt another member's session to start a test.

Local tests use a temporary HTTP listener bound to `127.0.0.1`, without publishing the host or requiring an account. The same single-use viewer grant and cookie checks protect it. The gateway owns the listener and closes it with the test session; its lease expires after three minutes. Local test IPC can address only sessions created for this purpose.

A local video-only test can run without native diagnostics. Its viewer iframe is inert and excluded from keyboard focus; it does not start a native input test or report input success. Local loopback test cookies use HttpOnly, Secure and SameSite=None so the embedded viewer works across the app origin.

On Linux, the gateway accepts only an X11 session (`DISPLAY` set, no `WAYLAND_DISPLAY`, and
`XDG_SESSION_TYPE` not `wayland`). Sunshine then runs with X11 capture and software encoding, and
sends input through XTest, so a hosted server under Xvfb needs no uinput device and no extra
capability. Linux has no permission checks: an X11 session is ready.
