import type { AgentTemplateDetail } from "@openbot/contracts/ipc";
import { Button, Dialog, Heading, IconButton, Text, TriangleAlert, X } from "@openbot/ui";
import { errorMessage } from "@openbot/ui/error-message";
import { createSignal, Show } from "solid-js";
import { AgentAvatar } from "./AgentAvatar";
import { TemplateInstructions, TemplateRoutines, TemplateSkills } from "./AgentTemplateSections";

export interface AgentTemplateInstallDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The template a link named. Null while it loads. */
  detail: AgentTemplateDetail | null;
  loading: boolean;
  /** A failure to load the template. An install failure is shown by the dialog itself. */
  error: string | null;
  onInstall: () => Promise<void>;
}

/**
 * What an `openbot://agents/<id>` link opens. It shows all of what the agent will follow before
 * anything is installed: a link alone never adds an agent.
 */
export function AgentTemplateInstallDialog(props: AgentTemplateInstallDialogProps) {
  const [installing, setInstalling] = createSignal(false);
  const [installError, setInstallError] = createSignal<string | null>(null);

  async function install(): Promise<void> {
    setInstalling(true);
    setInstallError(null);
    try {
      await props.onInstall();
    } catch (error) {
      setInstallError(errorMessage(error, "Could not add the agent."));
    } finally {
      setInstalling(false);
    }
  }

  function changeOpen(open: boolean): void {
    if (!open) setInstallError(null);
    props.onOpenChange(open);
  }

  return (
    <Dialog.Root open={props.open} onOpenChange={changeOpen}>
      <Dialog.Portal>
        <Dialog.Overlay class="agent-template-backdrop">
          <Dialog.Content as="section" class="agent-template-dialog" aria-busy={installing() ? "true" : undefined}>
            <Dialog.Title class="sr-only">Add {props.detail?.name ?? "shared agent"}</Dialog.Title>
            <Dialog.Description class="sr-only">
              Read the instructions, skills and routines of this shared agent before you add it.
            </Dialog.Description>
            <IconButton class="agent-template-close" label="Close" variant="ghost" onClick={() => changeOpen(false)}>
              <X />
            </IconButton>

            <Show
              when={props.detail}
              fallback={
                <div class="agent-template-body">
                  <Text tone={props.error ? "danger" : "muted"} role={props.error ? "alert" : "status"}>
                    {props.error ?? (props.loading ? "Loading agent…" : "")}
                  </Text>
                </div>
              }
            >
              {(detail) => (
                <>
                  <div class="agent-template-body agent-template-scroll">
                    <header class="agent-template-identity">
                      <AgentAvatar
                        seed={detail().avatarSeed}
                        hue={detail().avatarHue}
                        url={detail().avatarUrl}
                        motion="idle"
                        class="agent-template-avatar"
                      />
                      <Heading as="h2" size="md" class="agent-template-name">
                        {detail().name}
                      </Heading>
                      <Text tone="muted" variant="caption">
                        By {detail().creatorName}
                      </Text>
                    </header>
                    <div class="agent-template-warning" role="note">
                      <TriangleAlert aria-hidden="true" />
                      <Text variant="caption" tone="secondary">
                        This agent was made by another OpenBot user. It can act on your behalf after you add it.
                      </Text>
                    </div>
                    <div class="agent-template-detail">
                      <TemplateInstructions title={detail().title} description={detail().description} />
                      <TemplateSkills skills={detail().skills} expandable />
                      <TemplateRoutines routines={detail().routines} labelled />
                    </div>
                    <Show when={installError()}>
                      {(message) => (
                        <Text tone="danger" variant="caption" role="alert">
                          {message()}
                        </Text>
                      )}
                    </Show>
                  </div>
                  <footer class="agent-template-actions">
                    <Button type="button" variant="ghost" disabled={installing()} onClick={() => changeOpen(false)}>
                      Cancel
                    </Button>
                    <Button type="button" variant="default" disabled={installing()} onClick={() => void install()}>
                      {installing() ? "Adding…" : "Add agent"}
                    </Button>
                  </footer>
                </>
              )}
            </Show>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
