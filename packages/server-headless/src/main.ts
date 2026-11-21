// @openbot/server-headless — research entrypoint (WIP, not functional).
//
// Goal: boot the OpenBot server surface in Bun with no Electron. The sequence below
// mirrors what the Electron main process wires at startup (src/main/index.ts), with
// Electron-only parts stubbed or dropped. Every TODO points at the file that owns the
// real implementation; the exact instantiation order is being audited in
// docs/headless-bun-module-roadmap.md.
//
// Nothing here runs against the user data until the audit is complete and the CLI
// contract is verified. This file is the fork's plan, not a product.

// --- what we reuse from the repo (no Electron in these) -------------------------
// import { takeServerModeEnvironment } from "../../../src/main/server-mode";
//   TODO: takeServerModeEnvironment gates on isPackaged (Electron); a Bun build needs
//   an env-only variant: process.env.OPENBOT_SERVER === "1" + XDG_RUNTIME_DIR.
// import { createTeamApiServer } from "../../../src/main/team-api-server";
//   TODO: dependencies.ts lists the services it needs; build them in Bun.
// import { HostService } from "../../../src/main/host-service";
// import { CentralAuthManager } from "../../../src/main/central-auth-manager";
//   TODO: session persistence without gnome-keyring (--password-store=basic path).
// import { AgentService } from "../../../src/backend/agent-service";
//   TODO: ACP registry + provider runtime (opencode) over stdio.

// --- what we stub (Electron symbols used by application-services) ---------------
// app.getPath/getVersion/isPackaged -> XDG dirs + package.json version.
// powerMonitor/screen/Notification/Menu/shell -> no-ops on a server.
// BrowserWindow/WebContentsView/desktopCapturer -> unavailable; browser feature dropped.

// --- what we drop ---------------------------------------------------------------
// windows, IPC groups, preload/renderer, URL schemes, tray/dock, Computer Use,
// openbot_browser, deep links, desktop notifications, safe mode tied to app paths.

// --- boot sequence (planned) -----------------------------------------------------
// 1. Read env: OPENBOT_SERVER=1, XDG_RUNTIME_DIR, OPENBOT_AUTH_API_URL.
// 2. Open the agent database host process (same protocol the desktop uses).
// 3. Build CentralAuthManager with a file-backed session store (basic password store).
// 4. Build HostService, TeamStore, AgentService (+ ACP registry, provider runtimes).
// 5. Start TeamApiServer on 127.0.0.1 (the 122 routes).
// 6. Bind the control socket /run/openbot/control.sock with the /v1 routes.
// 7. Log "online <version>" in the same shape `openbot status` parses.

// Until the audit lands, this entrypoint only reports that it is a plan:
console.log(
  JSON.stringify({
    status: "scaffold",
    package: "@openbot/server-headless",
    see: "docs/headless-bun-module-roadmap.md",
    note: "not functional; boot sequence under audit",
  }),
);
