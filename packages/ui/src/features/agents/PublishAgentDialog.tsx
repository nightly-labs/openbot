import type { AgentTemplatePreview, MarketplaceAgentRoutine } from "@openbot/contracts/ipc";
import {
  ArrowLeft,
  Badge,
  Button,
  ChevronRight,
  Copy,
  Dialog,
  Heading,
  IconButton,
  ItemGroup,
  Link2Off,
  Text,
  toast,
  X,
} from "@openbot/ui";
import { errorMessage } from "@openbot/ui/error-message";
import { createSignal, Show } from "solid-js";
import { AgentAvatar } from "./AgentAvatar";
import { TemplateInstructions, TemplateRoutines, TemplateSkills } from "./AgentTemplateSections";

export interface PublishAgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The agent as it would be published, with its current publication. Null while it loads. */
  preview: AgentTemplatePreview | null;
  loading: boolean;
  onPublish: () => Promise<void>;
  onUnpublish: () => Promise<void>;
  onCopyLink: () => Promise<void>;
}

type View = "summary" | "context" | "routines";
type Pending = "publish" | "unpublish" | null;

/**
 * Publishes one agent as a link-only template: its instructions, skills and routines. Files and
 * memories stay on this computer. After a publish the same dialog can copy, update or remove the
 * link. The caller reports a finished action in a toast; a failed one is reported here.
 */
export function PublishAgentDialog(props: PublishAgentDialogProps) {
  const [view, setView] = createSignal<View>("summary");
  const [pending, setPending] = createSignal<Pending>(null);
  const published = () => props.preview?.publication ?? null;
  let content: HTMLElement | undefined;
  let closeButton: HTMLButtonElement | undefined;
  let primaryButton: HTMLButtonElement | undefined;

  /**
   * Only the button of the running action is disabled; the others stay as they are and ignore clicks
   * until it ends, so no button dims and comes back for nothing. A disabled button drops the focus to
   * the page, and the focus trap would pull it back and move the focus ring, so the panel holds the
   * focus while the action runs and the main button takes it back afterwards.
   */
  async function run(kind: Exclude<Pending, null>, action: () => Promise<void>, fallback: string): Promise<void> {
    if (pending()) return;
    content?.focus({ preventScroll: true });
    setPending(kind);
    try {
      await action();
    } catch (error) {
      toast.error(errorMessage(error, fallback));
    } finally {
      setPending(null);
      queueMicrotask(() => {
        if (!content?.contains(document.activeElement) || document.activeElement === content)
          (primaryButton?.isConnected ? primaryButton : closeButton)?.focus({ preventScroll: true });
      });
    }
  }

  /** A copy takes no time and changes nothing, so it has no pending state that could dim the buttons. */
  async function copyLink(): Promise<void> {
    if (pending()) return;
    try {
      await props.onCopyLink();
    } catch (error) {
      toast.error(errorMessage(error, "Could not copy the link."));
    }
  }

  function changeOpen(open: boolean): void {
    if (!open) setView("summary");
    props.onOpenChange(open);
  }

  return (
    <Dialog.Root open={props.open} onOpenChange={changeOpen}>
      <Dialog.Portal>
        <Dialog.Overlay class="agent-template-backdrop">
          <Dialog.Content
            ref={content}
            as="section"
            class="agent-template-dialog"
            aria-busy={pending() ? "true" : undefined}
            onOpenAutoFocus={(event) => {
              // Unpublish is the first control in the corner; the first focus must not land on it.
              event.preventDefault();
              closeButton?.focus({ preventScroll: true });
            }}
          >
            <Dialog.Title class="sr-only">Publish {props.preview?.name ?? "agent"}</Dialog.Title>
            <Dialog.Description class="sr-only">
              Share this agent as a template. Its instructions, skills and routines are published. Files and memories
              are not.
            </Dialog.Description>
            <Show when={published() && view() === "summary"}>
              <Badge variant="success-light" class="agent-template-status">
                Published
              </Badge>
            </Show>
            <div class="agent-template-corner-actions">
              <Show when={published() && view() === "summary"}>
                <IconButton
                  label={pending() === "unpublish" ? "Unpublishing…" : "Unpublish"}
                  variant="ghost"
                  disabled={pending() === "unpublish"}
                  onClick={() => void run("unpublish", props.onUnpublish, "Could not unpublish the agent.")}
                >
                  <Link2Off />
                </IconButton>
              </Show>
              <IconButton ref={closeButton} label="Close" variant="ghost" onClick={() => changeOpen(false)}>
                <X />
              </IconButton>
            </div>

            <Show
              when={props.preview}
              fallback={
                <div class="agent-template-body">
                  <Text tone="muted" role="status">
                    {props.loading ? "Loading agent…" : ""}
                  </Text>
                </div>
              }
            >
              {(preview) => (
                <Show
                  when={view() === "summary"}
                  fallback={
                    <TemplateDetailView
                      view={view() === "context" ? "context" : "routines"}
                      preview={preview()}
                      onBack={() => setView("summary")}
                    />
                  }
                >
                  <div class="agent-template-body">
                    <header class="agent-template-identity">
                      <AgentAvatar agent={preview()} motion="idle" class="agent-template-avatar" />
                      <Heading as="h2" size="md" class="agent-template-name">
                        {preview().name}
                      </Heading>
                      <Show when={preview().updatedAt}>
                        {(updatedAt) => (
                          <Text tone="muted" variant="caption">
                            Last updated {formatShortDate(updatedAt())}
                          </Text>
                        )}
                      </Show>
                      <Text tone="secondary" class="agent-template-description">
                        {preview().description}
                      </Text>
                    </header>

                    <ItemGroup surface="subtle" class="agent-template-rows">
                      <TemplateRow
                        title="Context"
                        detail={contextSummary(preview())}
                        onClick={() => setView("context")}
                      />
                      <TemplateRow
                        title="Routines"
                        detail={routinesSummary(preview().routines)}
                        onClick={() => setView("routines")}
                      />
                    </ItemGroup>
                  </div>

                  <footer class="agent-template-actions">
                    <Show
                      when={published()}
                      fallback={
                        <Button
                          ref={primaryButton}
                          type="button"
                          variant="default"
                          disabled={pending() === "publish"}
                          onClick={() => void run("publish", props.onPublish, "Could not publish the agent.")}
                        >
                          {pending() === "publish" ? "Publishing…" : "Publish"}
                        </Button>
                      }
                    >
                      <Button
                        type="button"
                        variant="outline"
                        class="agent-template-copy"
                        onClick={() => void copyLink()}
                      >
                        <Copy class="size-4" aria-hidden="true" />
                        Copy link
                      </Button>
                      <Button
                        ref={primaryButton}
                        type="button"
                        variant="default"
                        disabled={pending() === "publish"}
                        onClick={() => void run("publish", props.onPublish, "Could not update the agent.")}
                      >
                        {pending() === "publish" ? "Updating…" : "Update"}
                      </Button>
                    </Show>
                  </footer>
                </Show>
              )}
            </Show>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function TemplateRow(props: { title: string; detail: string; onClick: () => void }) {
  return (
    <Button type="button" variant="ghost" class="agent-template-row" onClick={props.onClick}>
      <span class="agent-template-row-copy">
        <span class="agent-template-row-title">{props.title}</span>
        <span class="agent-template-row-detail">{props.detail}</span>
      </span>
      <ChevronRight aria-hidden="true" />
    </Button>
  );
}

function TemplateDetailView(props: {
  view: "context" | "routines";
  preview: AgentTemplatePreview;
  onBack: () => void;
}) {
  return (
    <div class="agent-template-body">
      <header class="agent-template-detail-header">
        <IconButton label="Back" variant="ghost" onClick={props.onBack}>
          <ArrowLeft />
        </IconButton>
        <Heading as="h3" size="sm">
          {props.view === "context" ? "Context" : "Routines"}
        </Heading>
      </header>
      <div class="agent-template-detail">
        <Show when={props.view === "context"} fallback={<TemplateRoutines routines={props.preview.routines} />}>
          <TemplateInstructions title={props.preview.title} description={props.preview.description} />
          <TemplateSkills skills={props.preview.skills} />
          <Show when={props.preview.skillsError}>
            {(error) => (
              <Text tone="danger" variant="caption" role="alert">
                The skills cannot be published: {error()}
              </Text>
            )}
          </Show>
          <Text tone="muted" variant="caption">
            Files and memories are not published.
          </Text>
        </Show>
      </div>
    </div>
  );
}

function contextSummary(preview: AgentTemplatePreview) {
  if (preview.skillsError) return "Skills need attention";
  return preview.skills.length > 0 ? "Instructions and skills" : "Instructions";
}

function routinesSummary(routines: readonly MarketplaceAgentRoutine[]): string {
  const first = routines[0];
  if (!first) return "No routines";
  const others = routines.length - 1;
  if (others === 0) return first.name;
  return `${first.name} and ${others} ${others === 1 ? "other" : "others"}`;
}

function formatShortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(date);
}
