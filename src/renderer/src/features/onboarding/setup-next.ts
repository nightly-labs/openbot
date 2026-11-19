import { isKeyOnlyProvider } from "@openbot/contracts/agent-providers";
import type { AgentProviderId } from "@openbot/contracts/ipc";
import { toast } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createMemo } from "solid-js";
import type { SetupProviders } from "./SetupProviderPicker";

export function createSetupNext(providers: SetupProviders) {
  const { t, sourceText } = useText();
  const selectedOption = () => providers.options().find((candidate) => candidate.id === providers.selectedProvider());

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
      case "download-error": {
        const reason = option.runtimeStatus.message;
        return reason
          ? t("onboarding.next.downloadErrorReason", { provider, reason: sourceText(reason) })
          : t("onboarding.next.downloadError", { provider });
      }
      case "not-downloaded":
        return t("onboarding.next.notDownloaded", { provider });
      default:
        break;
    }
    if (option.connectionState === "connecting") return t("onboarding.next.connecting", { provider });
    return t("onboarding.next.connect", { provider });
  });

  function connectAction(provider: AgentProviderId): (() => void) | undefined {
    const source = providers.props;
    if (isKeyOnlyProvider(provider) && source.providerKeys) return () => providers.signInProvider(provider);
    const kind = source.connection?.connectKind(provider);
    if (kind === "browser") {
      return () => {
        toast.info(t("onboarding.toast.connecting", { provider: selectedOption()?.name ?? provider }));
        void providers.connectProvider(provider);
      };
    }
    if (kind === "dialog") return () => void providers.connectProvider(provider);
    if (provider === "opencode" && source.providerKeys) return () => providers.signInProvider(provider);
    return undefined;
  }

  function connectSelected(): void {
    const option = selectedOption();
    const runtimePhase = option?.runtimeStatus?.phase ?? "ready";
    if (
      option &&
      (runtimePhase === "not-downloaded" || runtimePhase === "download-error") &&
      providers.props.onDownloadProvider
    ) {
      void providers.downloadProvider(option.id);
      return;
    }
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
