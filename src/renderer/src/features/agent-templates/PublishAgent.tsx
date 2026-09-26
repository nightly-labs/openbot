import { type AgentTemplatePreview, isAgentTemplateCardPng } from "@openbot/contracts/ipc";
import { toast } from "@openbot/ui";
import { PublishAgentDialog } from "@openbot/ui/features/agents/PublishAgentDialog";
import { currentText } from "@openbot/ui/text";
import { createStore } from "solid-js";
import { writeClipboardText } from "../../clipboard";
import { renderAgentTemplateCard } from "./agent-template-card";
import { agentTemplatesPort } from "./agent-templates-port";

interface PublishState {
  open: boolean;
  agentId: string | null;
  preview: AgentTemplatePreview | null;
  loading: boolean;
}

/**
 * The publish dialog of the conversation header, and the calls behind it. `open` is what the header
 * button runs; `dialog` is mounted once beside the header.
 */
export function createPublishAgent() {
  const [state, setState] = createStore<PublishState>({
    open: false,
    agentId: null,
    preview: null,
    loading: false,
  });

  async function load(agentId: string): Promise<void> {
    try {
      const preview = await agentTemplatesPort().agentTemplates.preview(agentId);
      if (state.agentId !== agentId) return;
      setState((draft) => {
        draft.preview = preview;
        draft.loading = false;
      });
    } catch (error) {
      if (state.agentId !== agentId) return;
      // Nothing can be shown without the preview, so the dialog closes and the toast says why.
      setState((draft) => {
        draft.open = false;
        draft.agentId = null;
        draft.loading = false;
      });
      const { t, errorMessage } = currentText();
      toast.error(errorMessage(error, t("agentTemplate.publish.readFailed")));
    }
  }

  function open(agentId: string): void {
    setState((draft) => {
      draft.open = true;
      draft.agentId = agentId;
      draft.preview = null;
      draft.loading = true;
    });
    void load(agentId);
  }

  /** The preload rebuilt `shareUrl` from the id, on `openbot.run` or, in development, the local Worker. */
  async function copyShareLink(): Promise<boolean> {
    const publication = state.preview?.publication;
    if (!publication) return false;
    return writeClipboardText(publication.shareUrl).then(
      () => true,
      () => false,
    );
  }

  async function copyLink(): Promise<void> {
    const { t } = currentText();
    if (!(await copyShareLink())) throw new Error(t("agentTemplate.publish.copyFailed"));
    toast.success(t("agentTemplate.publish.copied"));
  }

  async function publish(): Promise<void> {
    const agentId = state.agentId;
    const preview = state.preview;
    if (!agentId || !preview) return;
    const update = preview.publication !== null;
    // The card is only the link preview image: when it cannot be drawn, or is too large for the
    // Worker to accept, the agent is published without it.
    const drawn = await renderAgentTemplateCard(preview).catch(() => null);
    const card = drawn && isAgentTemplateCardPng(drawn) ? drawn : null;
    const publication = await agentTemplatesPort().agentTemplates.publish({ agentId, card });
    if (state.agentId !== agentId) return;
    setState((draft) => {
      if (draft.preview) draft.preview.publication = publication;
    });
    // The agent is published even when the copy fails, so that is said, not reported as a failure.
    const copied = await copyShareLink();
    const { t } = currentText();
    toast.success(update ? t("agentTemplate.publish.updated") : t("agentTemplate.publish.publishedToast"), {
      description: copied ? t("agentTemplate.publish.linkCopied") : t("agentTemplate.publish.copyHint"),
    });
  }

  async function unpublish(): Promise<void> {
    const agentId = state.agentId;
    if (!agentId) return;
    await agentTemplatesPort().agentTemplates.unpublish(agentId);
    if (state.agentId !== agentId) return;
    setState((draft) => {
      if (draft.preview) draft.preview.publication = null;
    });
    const { t } = currentText();
    toast.success(t("agentTemplate.publish.unpublished"), { description: t("agentTemplate.publish.linkRemoved") });
  }

  const dialog = () => (
    <PublishAgentDialog
      open={state.open}
      onOpenChange={(next) =>
        setState((draft) => {
          draft.open = next;
          if (!next) draft.agentId = null;
        })
      }
      preview={state.preview}
      loading={state.loading}
      onPublish={publish}
      onUnpublish={unpublish}
      onCopyLink={copyLink}
    />
  );

  return { open, dialog };
}
