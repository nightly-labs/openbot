// Bun preload for `scripts/team-api-routes-e2e.ts`. The Team API server runs in the Electron main
// process, and two modules on its import graph (`trusted-ipc.ts` and `ipc/provider-handlers.ts`)
// import `ipcMain` and `shell` from `electron`. No Team API request that the E2E script makes calls
// them. This plugin gives Bun an `electron` module with only those two names, so the real server
// module loads outside Electron. A call to either stub fails, so a route that starts to use one
// fails the run instead of a silent no-op.
import { plugin } from "bun";

function unavailable(name) {
  return () => {
    throw new Error(`electron.${name} is not available in the Team API routes E2E run.`);
  };
}

plugin({
  name: "team-api-routes-e2e-electron",
  setup(build) {
    build.module("electron", () => ({
      exports: {
        ipcMain: { handle: unavailable("ipcMain.handle"), removeHandler: unavailable("ipcMain.removeHandler") },
        shell: { openExternal: unavailable("shell.openExternal") },
      },
      loader: "object",
    }));
  },
});
