// @openbot/server-headless — milestone 1: control socket + account session, Bun only.
//
// What runs today: restore the obk1 session (byte-compatible with the packaged
// server), serve the /v1 control surface in the same key=value format, and the
// email+code login against the account API with native fetch. Everything else in
// docs/headless-bun-module-roadmap.md is still TODO and stays wired off.
//
// Safety: never point this at the real userData while the Electron server runs.
// Default test root: ~/.config/openbot-headless-test; control socket under
// /run/openbot-headless-test. Override with OPENBOT_HEADLESS_USER_DATA and
// OPENBOT_HEADLESS_CONTROL_SOCKET.

import { homedir } from "node:os";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { HeadlessAuth } from "./headless-auth";
import { ControlSocket } from "./control-socket";

const userData = process.env.OPENBOT_HEADLESS_USER_DATA ?? join(homedir(), ".config", "openbot-headless-test");
const socketDir = process.env.OPENBOT_HEADLESS_CONTROL_DIR ?? "/run/openbot-headless-test";
const socketPath = join(socketDir, "control.sock");
const version = "0.0.1-headless";

mkdirSync(userData, { recursive: true });
mkdirSync(socketDir, { mode: 0o700, recursive: true });
rmSync(socketPath, { force: true });

const auth = new HeadlessAuth({ userData });
const state = await auth.restore();

const control = new ControlSocket({ socketPath, version, auth, serverName: "openbot-headless-test" });
await control.listen(() => undefined);

console.log(`openbot-headless ${version}`);
console.log(`account=${state.status}${state.email ? ` (${state.email})` : ""}`);
console.log(`control socket: ${socketPath}`);
console.log("login flow: curl --unix-socket %s -X POST -d 'email=you@example.com' http://openbot/v1/login/start", socketPath);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void control.close().finally(() => process.exit(0));
  });
}
