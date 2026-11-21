// @openbot/server-headless — research entrypoint (WIP, not functional).
//
// Goal: boot the OpenBot server surface in Bun with no Electron. The sequence below
// mirrors what the Electron main process wires at startup (src/main/index.ts), with
// Electron-only parts stubbed or dropped. Confirmed facts from the auth audit are
// inline; remaining TODOs point at the file that owns each implementation.
//
// Nothing here runs against the user data until the audit is complete and the CLI
// contract is verified. This file is the fork's plan, not a product.

// --- auth contract (CONFIRMED, measured on the host) -----------------------------
// Login is an opaque Bearer token against https://api.openbot.run (no OAuth, no cookie):
//   POST /v1/auth/email/start   {email}                  -> {challengeId, expiresAt, resendAt}
//     (header Idempotency-Key: <uuid4>; definitive errors: invalid_email,
//      sign_in_code_expired, email_delivery_rate_limited; 429 honors Retry-After)
//   POST /v1/auth/email/verify {challengeId, code}         -> {sessionToken, user}
//   GET  /v1/me with Authorization: Bearer ${sessionToken}  (401 = session revoked)
//   POST /v1/auth/logout                                  (revoke)
// OPENBOT_AUTH_API_URL overrides the origin (HTTPS or loopback only).
//
// Session persistence (CONFIRMED): ~/.config/OpenBot/openbot-central-auth-v1.bin holds
// base64("obk1" || IV(12) || GCM tag(16) || ciphertext) — AES-256-GCM keyed by
// ~/.config/OpenBot/secret-storage.key (base64 32B, created by the app itself).
// The plaintext JSON is {version: 2, sessionToken, teamHostTokens, mobileConnectLink?,
// user?}. No gnome-keyring involved on this host: the app's own fallback cipher
// (src/main/secret-storage-cipher.ts) owns the format. node:crypto covers all of it.
//
// Control socket (CONFIRMED): /run/openbot/control.sock, HTTP over unix socket,
// GET /v1/status and POST /v1/login/{start,verify,claim}, /v1/name, /v1/mobile-connect,
// /v1/logout; responses are plain "key=value\n" (src/main/server-mode.ts:249-273).
// The bash CLI /opt/OpenBot/hosted/openbot parses exactly that, so this module must
// answer with the same shape.
//
// What the mobile app needs beyond login (CONFIRMED scope):
//   1. TeamStore identity: ~/.config/OpenBot/openbot-team-server-v2.json — serverId +
//      keypair + owner (src/main/team-store.ts).
//   2. Host registration: POST /v2/remote/hosts/register {hostId, name,
//      ownerMembershipId, devicePublicKey, rotateCredential} -> machineToken.
//   3. Publication: POST /v2/remote/hosts/{hostId}/ticket {machineToken} ->
//      {ticket (JWT ES256), signalUrl}; connect the signal WebSocket -> online.
//   4. WebRTC peer-to-peer: the app reaches the Team API (122 routes,
//      src/main/team-api-server.ts) through a WebRTC data channel, never direct TCP.
//      This is the heaviest piece; it is what makes the server "online" for the phone.

// --- planned boot sequence --------------------------------------------------------
// 1. Read env: OPENBOT_SERVER=1, XDG_RUNTIME_DIR, OPENBOT_AUTH_API_URL.
// 2. Load or create secret-storage.key; decrypt openbot-central-auth-v1.bin.
// 3. Bind /run/openbot/control.sock; serve the /v1 routes with key=value responses.
// 4. If no session: CLI login flow (email -> code -> verify), persist obk1 format.
// 5. Build the backend service graph (agent database host, AgentService, ACP registry,
//    provider runtime opencode over stdio) — instantiation order pending the
//    bootstrap audit of application-services.ts.
// 6. Start TeamApiServer on 127.0.0.1 (122 routes, zero Electron imports).
// 7. HostService publish: register + ticket + signal WebSocket -> online for the app.
// 8. WebRTC host peer serving the Team API over a data channel.

// --- what we stub (Electron symbols used by application-services) ------------------
// app.getPath/getVersion/isPackaged -> XDG dirs + package.json version.
// powerMonitor/screen/Notification/Menu/shell -> no-ops on a server.
// BrowserWindow/WebContentsView/desktopCapturer -> unavailable; browser feature dropped.

// --- what we drop -------------------------------------------------------------------
// windows, IPC groups, preload/renderer, URL schemes, tray/dock, Computer Use,
// openbot_browser, deep links, desktop notifications, dbus, Xvfb, gnome-keyring.

console.log(
  JSON.stringify({
    status: "scaffold",
    package: "@openbot/server-headless",
    auth: "confirmed: bearer token + obk1 AES-256-GCM file, no keyring",
    pending: "bootstrap order, WebRTC host peer",
    see: "docs/headless-bun-module-roadmap.md",
    note: "not functional yet",
  }),
);
