import { describe, expect, it } from "vitest";
import { xwaylandRestartCommand } from "./xwayland-restart-command";

const base = {
  file: "/tmp/.mount_OpenBotAbc/openbot",
  argv: ["/tmp/.mount_OpenBotAbc/openbot", "openbot://invite/abc"],
  x11Argument: "--ozone-platform=x11",
  marker: "OPENBOT_XWAYLAND_RESTART",
  reason: "above-apps",
};

describe("xwaylandRestartCommand", () => {
  it("starts the file again, with this launch's arguments, the X11 argument and the marker", () => {
    const command = xwaylandRestartCommand({
      ...base,
      environment: { APPIMAGE: "/home/user/OpenBot.AppImage", HOME: "/home/user" },
    });
    expect(command).toEqual({
      file: "/tmp/.mount_OpenBotAbc/openbot",
      argv: ["/tmp/.mount_OpenBotAbc/openbot", "openbot://invite/abc", "--ozone-platform=x11"],
      env: { APPIMAGE: "/home/user/OpenBot.AppImage", HOME: "/home/user", OPENBOT_XWAYLAND_RESTART: "above-apps" },
    });
  });

  it("puts a different file first in the arguments", () => {
    const command = xwaylandRestartCommand({ ...base, file: "/home/user/OpenBot.AppImage", environment: {} });
    expect(command.file).toBe("/home/user/OpenBot.AppImage");
    expect(command.argv).toEqual(["/home/user/OpenBot.AppImage", "openbot://invite/abc", "--ozone-platform=x11"]);
  });

  it("does not change the environment of this process", () => {
    const environment: NodeJS.ProcessEnv = { HOME: "/home/user" };
    xwaylandRestartCommand({ ...base, environment });
    expect(environment).toEqual({ HOME: "/home/user" });
  });
});
