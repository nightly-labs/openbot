// @vitest-environment node

import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installLinuxDesktopEntry, linuxDesktopEntry } from "./linux-desktop-entry";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("linux desktop entry", () => {
  it("points the invitation scheme at the AppImage that is running", async () => {
    const home = await temporaryHome();
    const path = await installLinuxDesktopEntry({
      platform: "linux",
      environment: { APPIMAGE: "/home/jane/Applications/OpenBot-0.8.0-x86_64.AppImage" },
      iconPath: "/opt/openbot/resources/icons/icon-production.png",
      homeDirectory: home,
    });

    expect(path).toBe(join(home, ".local/share/applications/openbot.desktop"));
    const entry = await readFile(String(path), "utf8");
    expect(entry).toContain('Exec="/home/jane/Applications/OpenBot-0.8.0-x86_64.AppImage" %U');
    expect(entry).toContain("MimeType=x-scheme-handler/openbot;");
    expect(entry).toContain("Icon=/opt/openbot/resources/icons/icon-production.png");
    expect((await stat(String(path))).mode & 0o777).toBe(0o644);
  });

  it("writes into XDG_DATA_HOME when the user moved it", async () => {
    const home = await temporaryHome();
    const path = await installLinuxDesktopEntry({
      platform: "linux",
      environment: { APPIMAGE: "/opt/OpenBot.AppImage", XDG_DATA_HOME: join(home, "data") },
      iconPath: "/opt/openbot/icon.png",
      homeDirectory: home,
    });

    expect(path).toBe(join(home, "data/applications/openbot.desktop"));
  });

  it("leaves an entry a package manager owns alone", async () => {
    const home = await temporaryHome();

    await expect(
      installLinuxDesktopEntry({ platform: "linux", environment: {}, iconPath: "/icon.png", homeDirectory: home }),
    ).resolves.toBeNull();
    await expect(
      installLinuxDesktopEntry({
        platform: "darwin",
        environment: { APPIMAGE: "/opt/OpenBot.AppImage" },
        iconPath: "/icon.png",
        homeDirectory: home,
      }),
    ).resolves.toBeNull();
  });

  // A path with a space is ordinary on a desktop, and an unquoted one would make the entry launch
  // the wrong program with the rest of the path as arguments.
  it("quotes a path the desktop entry specification reserves characters in", () => {
    const entry = linuxDesktopEntry('/home/jane/My Apps/Open"Bot.AppImage', "/icon.png");

    expect(entry).toContain('Exec="/home/jane/My Apps/Open\\"Bot.AppImage" %U');
  });
});

async function temporaryHome(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "openbot-desktop-entry-test-"));
  roots.push(root);
  return root;
}
