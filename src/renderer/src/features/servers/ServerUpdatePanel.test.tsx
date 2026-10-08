import type { HostReleaseStatus, HostUpdateStatus } from "@openbot/contracts/ipc";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { Deferred, Effect } from "effect";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMockHostUpdate } from "../../preview/mock-host-update";
import { ServerUpdatePanel } from "./ServerUpdatePanel";

const unsupported: HostUpdateStatus = {
  currentVersion: "0.25.2",
  availableVersion: null,
  phase: "unsupported",
  progress: null,
  errorCode: null,
  remoteUpdates: "allowed",
  autoDownload: false,
  autoInstall: false,
  restart: null,
};
const available: HostReleaseStatus = {
  currentVersion: "0.25.2",
  latestVersion: "0.26.0",
  phase: "available",
  method: "hosted",
};
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("remote release checks", () => {
  it("lets a member request an idle update without administrator controls", async () => {
    const calls = createMockHostUpdate({
      hostUpdate: { ...unsupported, phase: "ready", availableVersion: "0.26.0" },
      hostRelease: { ...available, method: "self-update" },
    });
    const start = vi.spyOn(calls, "startUpdate");
    render(() => (
      <ServerUpdatePanel serverId="host" hostName="Host" actionsAvailable canManage={false} calls={calls} />
    ));
    await fireEvent.click(await screen.findByRole("button", { name: "Update when idle" }));
    await waitFor(() => expect(start).toHaveBeenCalledWith("when-idle", "host"));
    expect(await screen.findByRole("status")).toHaveTextContent("Host restarts when its agents are idle");
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel update" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Restart now" })).not.toBeInTheDocument();
  });

  it("checks a hosted box without offering installation controls", async () => {
    const calls = createMockHostUpdate({ hostUpdate: unsupported, hostRelease: { ...available, phase: "idle" } });
    const check = vi.spyOn(calls, "checkRelease");
    render(() => <ServerUpdatePanel serverId="host" hostName="Host" actionsAvailable calls={calls} />);
    const button = await screen.findByRole("button", { name: "Check for updates" });
    expect(button).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Update when idle" })).not.toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    await fireEvent.click(button);
    await waitFor(() => expect(check).toHaveBeenCalledWith("host"));
    expect(await screen.findByText("0.26.0 is available.")).toBeInTheDocument();
  });

  it.each(["managed", "disabled"] as const)(
    "offers read-only checks when installation is %s",
    async (remoteUpdates) => {
      const calls = createMockHostUpdate({
        hostUpdate: { ...unsupported, phase: "idle", remoteUpdates },
        hostRelease: { ...available, method: remoteUpdates === "managed" ? "host-manager" : "self-update" },
      });
      render(() => <ServerUpdatePanel serverId="host" hostName="Host" actionsAvailable calls={calls} />);
      expect(await screen.findByRole("button", { name: "Check for updates" })).toBeEnabled();
      expect(screen.queryByRole("button", { name: "Update when idle" })).not.toBeInTheDocument();
    },
  );

  it("lets an admin retry a failed release check", async () => {
    const calls = createMockHostUpdate({ hostUpdate: unsupported, hostRelease: { ...available, phase: "idle" } });
    vi.spyOn(calls, "checkRelease").mockResolvedValueOnce({ ...available, latestVersion: null, phase: "error" });
    render(() => <ServerUpdatePanel serverId="host" hostName="Host" actionsAvailable calls={calls} />);
    await fireEvent.click(await screen.findByRole("button", { name: "Check for updates" }));
    expect(
      await screen.findByText(
        "Host could not read the release feed. Check the host network connection, then try again.",
      ),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Check for updates" })).toBeEnabled());
    await fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    expect(await screen.findByText("0.26.0 is available.")).toBeInTheDocument();
  });

  it("reports an offline box, then reads the version again on reconnect", async () => {
    const calls = createMockHostUpdate({ hostUpdate: unsupported, hostRelease: available });
    vi.spyOn(calls, "getUpdateStatus").mockRejectedValueOnce(new Error("The host is offline."));
    const [online, setOnline] = createSignal(false);
    render(() => <ServerUpdatePanel serverId="host" hostName="Host" actionsAvailable={online()} calls={calls} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("The host is offline.");
    setOnline(true);
    expect(await screen.findByText("0.26.0 is available.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check for updates" })).toBeEnabled();
  });

  it("does not let a reply from the previous host replace the selected host", async () => {
    const previous = Deferred.makeUnsafe<HostUpdateStatus>();
    const previousResponse = Effect.runPromise(Deferred.await(previous));
    const calls = createMockHostUpdate({
      hostUpdate: { ...unsupported, currentVersion: "0.27.0" },
      hostRelease: { ...available, currentVersion: "0.27.0", phase: "up-to-date" },
    });
    const read = vi.spyOn(calls, "getUpdateStatus").mockImplementationOnce(() => previousResponse);
    const [serverId, setServerId] = createSignal("previous");
    render(() => <ServerUpdatePanel serverId={serverId()} hostName="Host" actionsAvailable calls={calls} />);
    await waitFor(() => expect(read).toHaveBeenCalledWith("previous"));
    setServerId("current");
    expect(await screen.findByText("OpenBot 0.27.0")).toBeInTheDocument();
    Effect.runSync(Deferred.succeed(previous, unsupported));
    await previousResponse;
    await waitFor(() => expect(screen.queryByText("OpenBot 0.25.2")).not.toBeInTheDocument());
    expect(screen.getByText("OpenBot 0.27.0")).toBeInTheDocument();
  });
});
