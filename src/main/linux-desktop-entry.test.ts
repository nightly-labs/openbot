// @vitest-environment node

import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
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
      iconPath: await temporaryIcon(home),
      homeDirectory: home,
    });

    expect(path).toBe(join(home, ".local/share/applications/openbot.desktop"));
    const entry = await readFile(String(path), "utf8");
    expect(entry).toContain('Exec="/home/jane/Applications/OpenBot-0.8.0-x86_64.AppImage" %U');
    expect(entry).toContain("MimeType=x-scheme-handler/openbot;");
    expect((await stat(String(path))).mode & 0o777).toBe(0o644);
  });

  // An AppImage unmounts its resources when it exits, so an entry that names the packaged icon
  // leaves the application menu without one for as long as OpenBot is not running.
  it("copies the icon out of the package and names the copy", async () => {
    const home = await temporaryHome();
    const iconPath = join(home, ".local/share/icons/openbot.png");
    const path = await installLinuxDesktopEntry({
      platform: "linux",
      environment: { APPIMAGE: "/tmp/.mount_OpenBoAbc123/OpenBot.AppImage" },
      iconPath: await temporaryIcon(home),
      homeDirectory: home,
    });

    expect(await readFile(String(path), "utf8")).toContain(`Icon=${iconPath}`);
    await expect(readFile(iconPath)).resolves.toEqual(Buffer.from("icon bytes"));
    expect((await stat(iconPath)).mode & 0o777).toBe(0o644);
  });

  // The entry is what registers the invitation scheme, so a missing icon must not stop it.
  it("names the packaged icon when it cannot copy one", async () => {
    const home = await temporaryHome();
    const path = await installLinuxDesktopEntry({
      platform: "linux",
      environment: { APPIMAGE: "/opt/OpenBot.AppImage" },
      iconPath: join(home, "absent.png"),
      homeDirectory: home,
    });

    expect(await readFile(String(path), "utf8")).toContain(`Icon=${join(home, "absent.png")}`);
  });

  it("writes into XDG_DATA_HOME when the user moved it", async () => {
    const home = await temporaryHome();
    const path = await installLinuxDesktopEntry({
      platform: "linux",
      environment: { APPIMAGE: "/opt/OpenBot.AppImage", XDG_DATA_HOME: join(home, "data") },
      iconPath: await temporaryIcon(home),
      homeDirectory: home,
    });

    expect(path).toBe(join(home, "data/applications/openbot.desktop"));
    expect(await readFile(String(path), "utf8")).toContain(`Icon=${join(home, "data/icons/openbot.png")}`);
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

/** Stands in for the icon the package carries, which is a PNG this test does not have to read. */
async function temporaryIcon(home: string): Promise<string> {
  const path = join(home, "packaged-icon.png");
  await writeFile(path, "icon bytes");
  return path;
}
