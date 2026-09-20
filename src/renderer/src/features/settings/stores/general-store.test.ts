import type {
  AgentProviderStatus,
  AgentStatus,
  ProviderApiKeyStatus,
  ProviderRuntimeStatus,
} from "@openbot/contracts/ipc";
import { createRoot } from "solid-js";
import { describe, expect, it } from "vitest";
import { createSettingsGeneralStore } from "./general-store";

/*
 * Whose CLI the General tab believes is in use.
 *
 * OpenBot downloads a managed OpenCode now, so an empty managed directory is the normal state for
 * everyone who installed the CLI themselves. If the row read that empty directory it would offer a
 * ~46 MB download to a user whose provider already answers, so this file holds the row to what the
 * agent reports instead.
 */
const notDownloaded: ProviderRuntimeStatus = { phase: "not-downloaded", progress: null, message: null, version: null };

function statusWith(provider: AgentProviderStatus): AgentStatus {
  return {
    phase: "ready",
    cliVersion: null,
    auth: { kind: "signed-out" },
    providers: [provider],
    capabilities: { chat: "ready", browser: "ready", computerUse: "ready" },
    message: null,
    fullAccess: true,
  };
}

function opencodeOption(agentStatus: AgentStatus, runtime: ProviderRuntimeStatus) {
  return createRoot((dispose) => {
    const store = createSettingsGeneralStore({
      agentStatus,
      providerRuntimeStatuses: { opencode: runtime },
    });
    const option = store.providerOptions().find((candidate) => candidate.id === "opencode");
    dispose();
    if (!option) throw new Error("Expected an OpenCode row.");
    return option;
  });
}

describe("settings general store", () => {
  it("reads an OpenCode a user installed as ready, not as a download", () => {
    const option = opencodeOption(
      statusWith({ id: "opencode", state: "available", version: "1.18.27", message: null, cliSource: "system" }),
      notDownloaded,
    );

    expect(option.runtimeStatus?.phase).toBe("ready");
    // The version the provider answers on, which is the user's own install and not the pinned one.
    expect(option.runtimeStatus?.version).toBe("1.18.27");
  });

  // The user's own CLI keeps answering while OpenBot installs the managed one over it, so the
  // agent reports the provider as available for the whole update. The row still has to report it.
  it("reports the update a user's own CLI is downloading rather than reading it as ready", () => {
    const option = opencodeOption(
      statusWith({ id: "opencode", state: "available", version: "1.18.27", message: null, cliSource: "system" }),
      { phase: "downloading", progress: 40, message: null, version: null },
    );

    expect(option.runtimeStatus?.phase).toBe("downloading");
    expect(option.runtimeStatus?.progress).toBe(40);
  });

  it("keeps offering the download while no CLI answers at all", () => {
    const option = opencodeOption(
      statusWith({ id: "opencode", state: "not-installed", version: null, message: null }),
      notDownloaded,
    );

    expect(option.runtimeStatus?.phase).toBe("not-downloaded");
  });

  it("carries the OpenCode key status to the row, and only there", () => {
    function optionWith(keyStatus: ProviderApiKeyStatus | undefined) {
      return createRoot((dispose) => {
        const store = createSettingsGeneralStore({
          agentStatus: statusWith({ id: "opencode", state: "available", version: "1.18.30", message: null }),
          providerRuntimeStatuses: { opencode: notDownloaded },
          openCodeKeyStatus: () => keyStatus,
        });
        const option = store.providerOptions().find((candidate) => candidate.id === "opencode");
        dispose();
        if (!option) throw new Error("Expected an OpenCode row.");
        return { option, options: store.providerOptions() };
      });
    }

    // Unknown until the first read: no badge rather than a wrong one.
    expect(optionWith(undefined).option.keyStatus).toBeUndefined();
    expect(optionWith("saved").option.keyStatus).toBe("saved");
    expect(
      optionWith("saved").options.every(
        (candidate) => candidate.id === "opencode" || candidate.keyStatus === undefined,
      ),
    ).toBe(true);
  });
});
