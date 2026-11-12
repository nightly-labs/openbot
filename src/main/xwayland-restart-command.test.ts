import { describe, expect, it } from "vitest";
import { xwaylandRestartCommand } from "./xwayland-restart-command";

const base = {
  execPath: "/opt/OpenBot/openbot",
  argv: ["/opt/OpenBot/openbot", "openbot://invite/abc"],
  x11Argument: "--ozone-platform=x11",
  marker: "OPENBOT_XWAYLAND_RESTART",
  reason: "above-apps",
};

describe("xwaylandRestartCommand", () => {
  it("starts the AppImage again, with this launch's arguments, the X11 argument and the marker", () => {
    const command = xwaylandRestartCommand({
      ...base,
      environment: { APPIMAGE: "/home/user/OpenBot.AppImage", HOME: "/home/user" },
    });
    expect(command).toEqual({
      file: "/home/user/OpenBot.AppImage",
      argv: ["/home/user/OpenBot.AppImage", "openbot://invite/abc", "--ozone-platform=x11"],
      env: { APPIMAGE: "/home/user/OpenBot.AppImage", HOME: "/home/user", OPENBOT_XWAYLAND_RESTART: "above-apps" },
    });
  });

  it("starts this executable again without an AppImage", () => {
    const command = xwaylandRestartCommand({ ...base, environment: {} });
    expect(command.file).toBe("/opt/OpenBot/openbot");
    expect(command.argv[0]).toBe("/opt/OpenBot/openbot");
  });

  it("does not change the environment of this process", () => {
    const environment: NodeJS.ProcessEnv = { HOME: "/home/user" };
    xwaylandRestartCommand({ ...base, environment });
    expect(environment).toEqual({ HOME: "/home/user" });
  });
});
