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
