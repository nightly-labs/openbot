import { createAgentTemplateShareUrl } from "@openbot/contracts/agent-template-links";
import type { AgentTemplatePreview } from "@openbot/contracts/ipc";
import { toast } from "@openbot/ui";
import { errorMessage } from "@openbot/ui/error-message";
import { PublishAgentDialog } from "@openbot/ui/features/agents/PublishAgentDialog";
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
      toast.error(errorMessage(error, "Could not read the agent."));
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

  /** Built from the id rather than read from `shareUrl`, so what is copied is what the route answers. */
  async function copyLink(): Promise<void> {
    const publication = state.preview?.publication;
    if (!publication) return;
    await writeClipboardText(createAgentTemplateShareUrl(publication.templateId)).catch(() => {
      throw new Error("Could not copy the link.");
    });
  }

  async function publish(): Promise<void> {
    const agentId = state.agentId;
    const preview = state.preview;
    if (!agentId || !preview) return;
    // The card is only the link preview image: when it cannot be drawn, the agent is published without it.
    const card = await renderAgentTemplateCard(preview).catch(() => null);
    const publication = await agentTemplatesPort().agentTemplates.publish({ agentId, card });
    if (state.agentId !== agentId) return;
    setState((draft) => {
      if (draft.preview) draft.preview.publication = publication;
    });
    await copyLink();
  }

  async function unpublish(): Promise<void> {
    const agentId = state.agentId;
    if (!agentId) return;
    await agentTemplatesPort().agentTemplates.unpublish(agentId);
    if (state.agentId !== agentId) return;
    setState((draft) => {
      if (draft.preview) draft.preview.publication = null;
    });
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
