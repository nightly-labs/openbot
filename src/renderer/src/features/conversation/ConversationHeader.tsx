import { ConversationHeader as SharedConversationHeader } from "@openbot/ui/features/conversation/ConversationHeader";
import { useConversationViewScope } from "./conversation-scope";

const loadAgentSettingsPanel = () => import("./AgentSettingsPanel");

import { toast } from "@openbot/ui";
import { errorMessage } from "@openbot/ui/error-message";
import { createMemo } from "solid-js";
import { useI18n } from "../../i18n-context";

/** @internal Stable HMR boundary for conversation header. */
export function ConversationHeader() {
  const i18n = useI18n();
  const {
    actingBrowserControl,
    agentActivity,
    browserControlAgent,
    hideBrowserPanel,
    props,
    screenOpen,
    selectAndConfirmModel,
    selectAndConfirmReasoning,
    setActiveRightPanel,
    settingsModel,
    settingsProvider,
    settingsReasoning,
    showBrowserPanel,
  } = useConversationViewScope();
  const changeAutoApprove = createMemo(() => {
    const save = props.onSetAgentAutoApprove;
    const name = props.agent?.name ?? "This agent";
    if (!save) return undefined;
    return (next: boolean) => {
      void save(next).catch((error) => {
        toast.error(
          next
            ? errorMessage(error, `Could not save the standing approval for ${name}. Try again.`)
            : i18n.t("settings.autoApprove.revokeFailed", { name }),
        );
      });
    };
  });
  return (
    <SharedConversationHeader
      agent={props.agent}
      onSettingsIntent={() => void loadAgentSettingsPanel()}
      onOpenSettings={() => setActiveRightPanel("settings")}
      modelPicker={{
        provider: settingsProvider(),
        value: settingsModel(),
        reasoningEffort: settingsReasoning(),
        modelOptions: props.modelOptions,
        agentStatus: props.agentStatus,
        runtimeStatuses: props.providerRuntimeStatuses,
        customProviders: props.customProviders,
        onDownloadProvider: props.onDownloadProvider,
        onCancelProviderDownload: props.onCancelProviderDownload,
        onConnectProvider: props.onConnectProvider,
        modelChangesDisabled: agentActivity() === "Working",
        disabledReason:
          agentActivity() === "Working"
            ? "Wait for the current work to finish before changing models."
            : "Models are available after an agent CLI connects.",
        onChange: (model, provider) => void selectAndConfirmModel(model, provider),
        onReasoningEffortChange: (effort) => void selectAndConfirmReasoning(effort),
        autoApprove: props.agentAutoApproves,
        agentName: props.agent?.name,
        autoApproveLocked: props.agentAutoApproveLocked,
        onAutoApproveChange: changeAutoApprove(),
      }}
      remoteControl={
        props.remoteDesktopEnabled !== false && props.server?.kind === "remote"
          ? {
              enabled: Boolean(props.remoteDesktopSessionActive || props.server.state === "online"),
              active: Boolean(props.remoteDesktopSessionActive),
              visible: Boolean(props.remoteDesktopVisible),
              onOpen: (trigger) => {
                if (props.server) void props.onOpenRemoteDesktop(props.server.id, trigger);
              },
            }
          : undefined
      }
      browser={
        props.browserEnabled !== false
          ? {
              acting: Boolean(actingBrowserControl()),
              agentName: browserControlAgent()?.name,
              open: screenOpen(),
              disabled: props.browserVisibilitySuspended,
              onToggle: () => {
                if (screenOpen()) hideBrowserPanel();
                else showBrowserPanel();
              },
            }
          : undefined
      }
    />
  );
}
