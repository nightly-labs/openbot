import type { AgentTemplateDetail } from "@openbot/contracts/ipc";
import { Button, Dialog, Heading, IconButton, Text, toast, X } from "@openbot/ui";
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
  onInstall: () => Promise<void>;
}

/**
 * What an `openbot://agents/<id>` link opens. It shows all of what the agent will follow before
 * anything is installed: a link alone never adds an agent.
 */
export function AgentTemplateInstallDialog(props: AgentTemplateInstallDialogProps) {
  const [installing, setInstalling] = createSignal(false);

  async function install(): Promise<void> {
    setInstalling(true);
    try {
      await props.onInstall();
    } catch (error) {
      toast.error(errorMessage(error, "Could not add the agent."));
    } finally {
      setInstalling(false);
    }
  }

  function changeOpen(open: boolean): void {
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
            <div class="agent-template-corner-actions">
              <IconButton label="Close" variant="ghost" onClick={() => changeOpen(false)}>
                <X />
              </IconButton>
            </div>

            <Show
              when={props.detail}
              fallback={
                <div class="agent-template-body">
                  <Text tone="muted" role="status">
                    {props.loading ? "Loading agent…" : ""}
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
                    <div class="agent-template-detail">
                      <TemplateInstructions title={detail().title} description={detail().description} />
                      <TemplateSkills skills={detail().skills} expandable />
                      <TemplateRoutines routines={detail().routines} labelled />
                    </div>
                  </div>
                  {/* The same quiet line the share page shows above its button, right where the choice is made. */}
                  <Text variant="caption" tone="muted" class="agent-template-notice" role="note">
                    Made by another OpenBot user. It can act on your behalf once added.
                  </Text>
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
