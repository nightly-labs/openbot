import { classifyFailure } from "@openbot/telemetry";
import { ConversationHeader as SharedConversationHeader } from "@openbot/ui/features/conversation/ConversationHeader";
import { useConversationViewScope } from "./conversation-scope";

const loadAgentSettingsPanel = () => import("./AgentSettingsPanel");

import { useText } from "@openbot/ui/text";
import { createMemo } from "solid-js";
import { actionToast } from "../../action-toast";
import { serverHasStorage } from "../files/storage-usage";

/** @internal Stable HMR boundary for conversation header. */
export function ConversationHeader() {
  const { t, errorMessage } = useText();
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
    filesOpen,
    toggleFilesPanel,
  } = useConversationViewScope();
  const changeAutoApprove = createMemo(() => {
    const save = props.onSetAgentAutoApprove;
    const name = props.agent?.name ?? t("conversation.header.thisAgent");
    if (!save) return undefined;
    return (next: boolean) => {
      void save(next).catch((error) => {
        actionToast.error(
          next
            ? errorMessage(error, t("conversation.header.grantFailed", { name }))
            : t("settings.autoApprove.revokeFailed", { name }),
          { report: { operation: "turn", source: "action", cause_code: classifyFailure(error) } },
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
        customAgents: props.customAgents,
        onDownloadProvider: props.onDownloadProvider,
        onCancelProviderDownload: props.onCancelProviderDownload,
        onConnectProvider: props.onConnectProvider,
        modelChangesDisabled: agentActivity() === "Working",
        disabledReason:
          agentActivity() === "Working"
            ? t("conversation.header.modelsBusy")
            : t("conversation.header.modelsUnavailable"),
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
      files={
        // The web client has no conversation Files panel, and a chat without a thread has no files to list.
        !props.runtime && props.agent?.threadId && serverHasStorage(props.server)
          ? { open: filesOpen(), onToggle: toggleFilesPanel }
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
