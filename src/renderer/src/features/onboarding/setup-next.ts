import type { AgentProviderId } from "@openbot/contracts/ipc";
import { toast } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createMemo } from "solid-js";
import type { SetupProviders } from "./SetupProviderPicker";

/**
 * The main button of a provider step while the selected provider is not connected, as the first-run
 * flow and the server step both show it.
 */
export function createSetupNext(providers: SetupProviders) {
  const { t } = useText();
  const selectedOption = () => providers.options().find((candidate) => candidate.id === providers.selectedProvider());

  /**
   * Why `Next` refuses, or an empty string when it does not.
   *
   * The sentence is the only account the screen gives. A first run whose providers are all still
   * being checked otherwise shows a list of rows and a dead button, which reads as a broken
   * application rather than as work left to do.
   */
  const blockedReason = createMemo(() => {
    if (providers.selectedProviderConnected()) return "";
    const option = selectedOption();
    if (!option) return t("onboarding.next.selectProvider");
    const provider = option.name;
    switch (option.runtimeStatus?.phase) {
      case "downloading":
        return t("onboarding.next.downloading", { provider });
      case "finishing":
        return t("onboarding.next.finishing", { provider });
      case "download-error":
        return t("onboarding.next.downloadError", { provider });
      case "not-downloaded":
        return t("onboarding.next.notDownloaded", { provider });
      default:
        break;
    }
    if (option.connectionState === "connecting") return t("onboarding.next.connecting", { provider });
    return t("onboarding.next.connect", { provider });
  });

  /**
   * How the button connects `provider` now, or undefined when it cannot. This computer connects in
   * its own browser. A host has no browser the user can see, so it signs in with a code, or with the
   * OpenCode key; each opens a dialog, which is the feedback.
   */
  function connectAction(provider: AgentProviderId): (() => void) | undefined {
    const source = providers.props;
    if (source.onConnectProvider) {
      return () => {
        toast.info(t("onboarding.toast.connecting", { provider: selectedOption()?.name ?? provider }));
        void providers.connectProvider(provider);
      };
    }
    const codeLogin = source.codeLogin;
    if (codeLogin?.providers().includes(provider)) return () => codeLogin.start(provider);
    if (provider === "opencode" && source.providerKeys) return () => providers.signInProvider(provider);
    return undefined;
  }

  /**
   * It stays pressable: a disabled `Next` beside rows of "Ready" badges read as a broken screen
   * (issue #643). It connects the provider when a connection can start now, and else the toast says
   * what is missing.
   */
  function connectSelected(): void {
    const option = selectedOption();
    const runtimePhase = option?.runtimeStatus?.phase ?? "ready";
    const connect =
      option &&
      !providers.props.refreshingProviders &&
      runtimePhase === "ready" &&
      option.connectionState !== "connecting"
        ? connectAction(option.id)
        : undefined;
    if (!connect) {
      toast.info(blockedReason());
      return;
    }
    connect();
  }

  return { blockedReason, connectSelected };
}
