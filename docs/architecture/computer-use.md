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
stays empty, because ACP has no field for one, so an entry with one would vanish for ACP providers
with no error. Codex staleness needs no separate signal, because
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
changing provider sessions. The tap removes the driver's own cursor tools (`set_agent_cursor_*`
and `get_agent_cursor_state`) from the tool list: with `--no-overlay` they change nothing on the
screen, and on macOS they refuse. `move_cursor` stays, because OpenBot draws its cursor at the
point of that call. A `click` or a `scroll` aimed at a window names a pixel of that window's last
`get_window_state` screenshot, not a desktop point. The tap keeps the `screenshot_width` of each
window from that answer and saves it with the point when the click passes. The cursor goes to the
window's top-left corner plus the point times the window width divided by that screenshot width,
as the driver computes it. A click that OpenBot cannot place (no `window_id`, a point in a `zoom`
image, or no screenshot width yet) removes the cursor. A window that is not in `list_windows` gets
no cursor.

### Agent display on a server

A self-hosted server and the container start two Xvfb displays, and name the agent display in
`OPENBOT_AGENT_DISPLAY`. The agent display has a white root (Xvfb `-wr`), because remote desktop
shows a black root as if no video came. `xsetroot` gives it an arrow pointer, because the default
"×" of an empty display looks like an error, and `-noreset` keeps the arrow. A boat hosted server
names its desktop `:0`, and OpenBot
runs on an Xvfb display. Electron keeps its own `DISPLAY`: the built-in browser draws its tabs in
the OpenBot window, and under Xvfb a hidden view gives no capture and no clicks, so OpenBot cannot
only hide its window. On Linux, `agent-display.ts` sets `DISPLAY` to the agent display for the
driver daemon, for Sunshine, and in `agentEnvironment` for every agent process. The driver and
Sunshine open the display that `DISPLAY` names, so a screenshot, an input event and the remote
desktop stream all use the agent display, and a program that an agent starts opens there. The
per-display overlays are OpenBot windows, so with an agent display they are not started: nothing
draws the agent cursor or the rim there. `capture_screen` and `list_capture_sources` use Electron's
`desktopCapturer`, which sees only the OpenBot display, so with an agent display they are not
available, and agents take screenshots with the driver.

`openbot.service` holds the Xvfb displays too, and a stop signals each process of the unit at the
same time. An Xvfb that stops first ends OpenBot before it closes its database. So the unit's
`ExecStop` runs `openbot-hosted-server --stop`: it sends `SIGTERM` to OpenBot only, whose PID the
script writes to `$XDG_RUNTIME_DIR/openbot.pid`, and waits for it. Then it waits at most 10 s for
the main process of the unit, so that `xvfb-run` completes its `xauth remove`. An `xauth` that the
stop signal ended left the `~/.Xauthority-c` lock, and each later start failed after 20 to 40 s.
The start also removes these lock files when no `xauth` of the user runs. The container does not
need this: tini signals only OpenBot.

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

A paste in the viewer puts the member's text on the host's clipboard, and then presses the host's
paste keys. Moonlight sends Cmd+V or Ctrl+V as keys and cancels them, so the browser fires no paste
event and the host pastes its own clipboard. The gateway adds `openbot-paste.js` to Moonlight's
`stream.html`. The script keeps the member's paste key from Moonlight, reads the paste event, and
posts the text to `moonlight/openbot-clipboard`. Both routes are under `moonlight/` because the
released Team API adapters forward only that family of viewer routes. The same viewer cookie or
WebRTC session check protects them, and the clipboard route refuses a request from another site.
At the paste event, the script presses the host's paste modifier, Cmd for a macOS host or Ctrl for
other hosts, and releases the member's other held modifiers except Shift. A Win or Super key
released with no key between would open the host's Start menu or Activities. After the upload, the
script presses V. Text that the host
already has from an earlier paste is not sent again, so a copy made on the host stays on its
clipboard. A host with no clipboard writer serves neither route.

On Linux, the gateway accepts only an X11 session (`DISPLAY` set, no `WAYLAND_DISPLAY`, and
`XDG_SESSION_TYPE` not `wayland`). Sunshine then runs with X11 capture and software encoding, and
sends input through XTest, so a hosted server under Xvfb needs no uinput device and no extra
capability. On a server with an agent display, Sunshine runs on that display (see
[Agent display on a server](#agent-display-on-a-server)). Linux has no permission checks: an X11 session is ready.

### Host controls

The host owner chooses in Server settings › Remote desktop which roles may start a session
(`owner`, `admins` or `members`; `members` by default) and whether the person at the computer must
allow each session. The section shows for the local server on every platform; the client setup
steps in it stay macOS only. `remote-control-policy-store.ts` keeps both settings in a JSON file in
userData, as the Private network setting does. The route checks the role on `sessions`, `setup`,
`test` and `display`: a new display restarts every open stream.

`remote-control-question.ts` asks with a sheet on the main window. A request is refused when
nobody allows it in 30 s, when a revoke or Stop all ends it, or when a client on a direct HTTP
connection drops it. A WebRTC client has no cancel frame, so its question stays until an answer or
the 30 s end. A released desktop client on direct HTTP stops waiting after 15 s. After Allow, the
runtime can take seconds to start; a revoke or Stop all in that time also refuses the request. A
host with no window refuses every session while the question is on. Both refusals are a 403 with a
localized message and no code: every released protocol rejects an error code it does not know.

The gateway's audit events show the sign: a notification at the first stream of a remote session,
and the tray item with the member's name and **Stop all remote control** while the session exists.
A session that a client leaves without a close stays until it is closed, revoked, or its team
session ends. A local test session does not count.

An extra server on the same computer (`local-server-child.ts`) runs its own gateway with its own
policy file and no question, tray or notification. Its members are not covered by the desktop's
settings.

### Remote desktop on the phone

The mobile app shows the host's own Moonlight Web viewer, as the desktop app does
(`apps/mobile/src/features/remote-desktop`). The viewer is code from the host, so it runs in a
plain `react-native-webview`, not in an Expo DOM component: the web view has no `onMessage`, loads
only its loopback address, and cannot call the app. The app calls the page with `injectJavaScript`.

- `modules/remote-viewer-proxy` is a native HTTP and WebSocket server on `127.0.0.1` (Swift and
  Kotlin). It answers 404 to a path without the session's random token and reads only HTTP and
  WebSocket frames. `viewer-proxy.ts` sends each request to the host as a Team API request, and
  rewrites `/v1/remote-screen` in HTML and JavaScript as `RemoteViewerProxy` does on desktop. It
  takes only the routes of its own session.
- The viewer's signaling socket goes over the peer's desktop channel. The hidden peer page
  (`remote-desktop-relay.ts`) relays it with the `remote-stream-v1` frames; the browser live view
  reads the same channel and leaves frames of other streams alone.
- The proxy reads the viewer's `viewer-state` reports on their way to the host, so the screen
  knows when the first frame arrives (the desktop's 60 s limit) and whether the video is direct or
  relayed. A failure report does not close the page: after a display change the host closes the
  stream socket with 4410, and the viewer loads again by itself. During a display change the screen
  says "Switching to <display>…" and keeps the old stream's end report. It shows that report, or a
  switch failure, only when the new stream shows no picture within 30 s.
- The app's page script sets Moonlight's `mlSettings` before the page starts: H.264, a stream no
  wider than 1920 px (Fast, 120 fps, 20 Mbit/s; Smooth, 60 fps, 10 Mbit/s) or 1280 px (Data saver,
  30 fps, 3 Mbit/s), and Moonlight's `mouseRelative` (Trackpad mode) or `pointAndDrag` touch mode.
  Sunshine on macOS captures no faster than the display, so Fast sends more frames only from a
  display of 120 Hz or more. The script also puts the app's background in place of Moonlight's blue
  page, which is a `body::before` layer, and hides Moonlight's stats overlay.
- Connection stats is a sheet. While it is open, the page posts Moonlight's stats once a second to
  `moonlight/openbot-phone-stats`. The proxy answers that one path itself and sends it to no host,
  so the page gets no other way to reach the app. Moonlight's WebRTC values named "…Ms" are running
  totals in seconds, so the sheet shows the time per frame from the change between two samples. Copy
  in the sheet's header copies the shown values and Moonlight's raw values.
  OpenBot's patch hides Moonlight's sidebar, so the app adds a key bar above the phone keyboard.
- Typing sends `keydown` and `keyup` of a US keyboard to the document, as the paste script does.
  Sunshine on macOS does not type text ("Unicode input not yet implemented for MacOS"), so only a
  character with no key goes through Moonlight's `sendText`, which Windows and Linux hosts type.
- Zoom is a transform of Moonlight's `.video-stream` element. That element is `position: fixed`, so
  a transform of a parent would move it out of view. Moonlight's page animates every transform for
  0.25 s, so the script turns off the video's transition: each pan step reads the video's place,
  and a place in mid-animation made the view drift. Moonlight maps a touch through the video's
  bounding box, so a touch lands where the finger is.
- Trackpad mode is Moonlight's `localCursor` touch mode: the finger moves the pointer as on a
  trackpad, and Moonlight sends the pointer's position, so the page knows it. While zoomed in, the
  view follows the pointer when the pointer moves near an edge or under the app's bars. A view that
  the fingers moved away from the pointer stays there until the pointer moves. Moonlight's own pointer drawing is hidden, because
  the computer's pointer is in the video. A pinch zooms and moves the view with the fingers; three
  fingers move the view. For a gesture that the view takes, the script calls Moonlight's
  `onTouchCancel`, so a finger that Moonlight saw first does not click. At any zoom, a two-finger
  drag scrolls the computer and a two-finger tap right-clicks.
- Before a session the phone asks for Face ID, Touch ID or the phone unlock. It ends the session
  when the app leaves the foreground, covers the screen in the app switcher, keeps the phone awake,
  and sets `FLAG_SECURE` on Android.

### Codex tool approvals

Codex saves an “Always allow” tool decision only when the MCP server is in a file-backed
configuration layer. A thread configuration alone does not satisfy this check. Before starting or
resuming a thread with Computer Use, OpenBot registers `computer_use` in the Codex user
configuration through `config/batchWrite`. The new entry contains only a placeholder command
(`openbot-mcp`) and `enabled = false`. The write uses the user layer's version, and an existing entry is left unchanged.
OpenBot does not save the driver socket, environment, or credentials in that entry.

The thread configuration enables the running driver and supplies its current command, arguments,
and environment. It also carries the saved per-tool settings, including `set_value.approval_mode`.
Saved tool settings are also in the session fingerprint. When an approval changes, the next turn
replaces a loaded provider session that holds the old policy.
An agent with Full access does not ask: OpenBot accepts each Computer Use tool consent once and
saves nothing, as it does for other MCP tools. A Workspace only or Ask first agent shows the card,
and Codex keeps "Always allow" per tool and per provider account.
When Computer Use is off for the agent or the driver is unavailable, the thread keeps the saved
entry disabled. A registration failure stops the thread with steps to repair the configuration or
turn off Computer Use. The application-access questions from the driver still use their existing
approval flow.
