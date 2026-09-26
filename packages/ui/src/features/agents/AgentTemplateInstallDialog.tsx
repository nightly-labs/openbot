import type { AgentTemplateDetail } from "@openbot/contracts/ipc";
import { Button, Dialog, Heading, IconButton, Text, toast, X } from "@openbot/ui";
import { createSignal, Show } from "solid-js";
import { useText } from "../../text";
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
  const { t, errorMessage } = useText();
  const [installing, setInstalling] = createSignal(false);

  async function install(): Promise<void> {
    setInstalling(true);
    try {
      await props.onInstall();
    } catch (error) {
      toast.error(errorMessage(error, t("agentTemplate.install.failed")));
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
            <Dialog.Title class="sr-only">
              {t("agentTemplate.install.title", {
                name: props.detail?.name ?? t("agentTemplate.install.nameFallback"),
              })}
            </Dialog.Title>
            <Dialog.Description class="sr-only">{t("agentTemplate.install.description")}</Dialog.Description>
            <div class="agent-template-corner-actions">
              <IconButton label={t("common.close")} variant="ghost" onClick={() => changeOpen(false)}>
                <X />
              </IconButton>
            </div>

            <Show
              when={props.detail}
              fallback={
                <div class="agent-template-body">
                  <Text tone="muted" role="status">
                    {props.loading ? t("agentTemplate.install.loading") : ""}
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
                        {t("agentTemplate.creator", { name: detail().creatorName })}
                      </Text>
                    </header>
                    <div class="agent-template-detail">
                      <TemplateInstructions title={detail().title} description={detail().description} />
                      <TemplateSkills skills={detail().skills} expandable />
                      <TemplateRoutines routines={detail().routines} labelled />
                    </div>
                  </div>
                  <footer class="agent-template-actions">
                    <Button type="button" variant="ghost" disabled={installing()} onClick={() => changeOpen(false)}>
                      {t("common.cancel")}
                    </Button>
                    <Button type="button" variant="default" disabled={installing()} onClick={() => void install()}>
                      {installing() ? t("agentTemplate.install.pending") : t("agentTemplate.install.action")}
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
