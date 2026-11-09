import { AppLogo } from "@openbot/brand";
import { installServerCommand, type ServerClaim } from "@openbot/contracts/hosted-servers";
import { Button, Check, CircleAlert, Copy, Dialog, Heading, IconButton, LoaderCircle, Text, X } from "@openbot/ui";
import { createSignal, Match, onCleanup, onSettled, Show, Switch } from "solid-js";
import { useText } from "../../text";
import { CodeBlock } from "../conversation/CodeBlock";

/**
 * - making: the app asks the account service for a claim.
 * - waiting: the command shows. No server used the claim yet.
 * - starting: a new server is in the server list, but it is not online yet.
 * - connected: the new server is online.
 * - expired: nobody used the claim before it expired.
 * - failed: the account service did not make a claim.
 */
export type InstallServerStep = "making" | "waiting" | "starting" | "connected" | "expired" | "failed";

export interface InstallServerDialogProps {
  step: InstallServerStep;
  /** The claim of the shown command. It stays while the step is `starting`, `connected` or `expired`. */
  claim: ServerClaim | null;
  /** The new server, from the step `starting`. */
  serverName: string | null;
  /** The cause of the step `failed`. */
  error: unknown;
  onNewCommand: () => void;
  /**
   * Puts an SSH task into the composer of the open chat. The agent gets its own command. Absent: no chat can take it.
   * Shown while the step is `waiting`.
   */
  onSetUpWithAgent?: (() => void) | undefined;
  onOpenServer: () => void;
  onClose: () => void;
}

const formatRemaining = (ms: number) => {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

/**
 * One command that installs OpenBot on a Linux computer or VPS and signs the server in to this account.
 * A person or an AI agent runs it. The dialog then waits until the new server is online.
 */
export function InstallServerDialog(props: InstallServerDialogProps) {
  const { t, errorMessage } = useText();
  const [now, setNow] = createSignal(Date.now());
  onSettled(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(tick);
  });
  const remaining = () => formatRemaining((props.claim?.expiresAt ?? 0) - now());
  const command = () => (props.claim ? installServerCommand(props.claim.claim) : "");
  const serverName = () => props.serverName ?? "";
  const canCopy = () => props.step === "waiting";
  const expired = () => props.step === "expired";

  return (
    <Dialog.Root open={true} onOpenChange={(open) => !open && props.onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay class="join-server-backdrop" data-motion="open">
          <Dialog.Content as="section" class="join-server-dialog t-modal is-open install-server-dialog">
            <Dialog.Title class="sr-only">{t("server.install.title")}</Dialog.Title>
            <Dialog.Description class="sr-only">{t("server.install.description")}</Dialog.Description>
            <IconButton
              class="join-server-close"
              label={t("common.close")}
              tooltip={t("common.close")}
              variant="ghost"
              onClick={props.onClose}
            >
              <X />
            </IconButton>
            <div class="join-server-content">
              <div class="install-server-page">
                <header class="join-server-header join-server-header-entry">
                  <AppLogo variant="production" class="join-server-entry-logo" />
                  <Heading as="h2" size="lg">
                    {t("server.install.title")}
                  </Heading>
                  <Text tone="muted">{t("server.install.description")}</Text>
                </header>

                <Switch>
                  <Match when={props.step === "making"}>
                    <div class="install-server-placeholder" role="status">
                      <LoaderCircle class="install-server-spin" aria-hidden="true" />
                      <Text tone="muted">{t("server.install.making")}</Text>
                    </div>
                  </Match>
                  <Match when={props.step === "failed"}>
                    <div class="install-server-placeholder" role="alert">
                      <CircleAlert class="install-server-danger" aria-hidden="true" />
                      <Text tone="danger">{errorMessage(props.error, t("server.install.failed"))}</Text>
                      <Button variant="secondary" size="sm" onClick={props.onNewCommand}>
                        {t("common.tryAgain")}
                      </Button>
                    </div>
                  </Match>
                  <Match when={true}>
                    <div class="install-server-block" data-expired={expired() ? "" : undefined}>
                      <CodeBlock
                        block={{ type: "code", code: command(), language: "sh" }}
                        actions={
                          <Show when={canCopy()}>
                            <CopyForAgentButton command={command()} />
                          </Show>
                        }
                      />
                      <Show when={props.step === "waiting"}>
                        <div class="install-server-code-row">
                          <Text variant="caption" tone="muted">
                            {t("server.install.expiresIn", { time: remaining() })}
                          </Text>
                          <Button variant="ghost" size="sm" onClick={props.onNewCommand}>
                            {t("server.install.newCommand")}
                          </Button>
                        </div>
                      </Show>
                    </div>
                    <div class="install-server-status" aria-live="polite">
                      <Switch>
                        <Match when={props.step === "waiting"}>
                          <LoaderCircle class="install-server-spin" aria-hidden="true" />
                          <Text tone="muted">{t("server.install.waiting")}</Text>
                        </Match>
                        <Match when={props.step === "starting"}>
                          <LoaderCircle class="install-server-spin" aria-hidden="true" />
                          <Text>{t("server.install.starting", { name: serverName() })}</Text>
                        </Match>
                        <Match when={props.step === "connected"}>
                          <Check class="install-server-ok" aria-hidden="true" />
                          <Text>{t("server.install.connected", { name: serverName() })}</Text>
                        </Match>
                        <Match when={expired()}>
                          <CircleAlert class="install-server-warning" aria-hidden="true" />
                          <Text tone="warning">{t("server.install.expired")}</Text>
                        </Match>
                      </Switch>
                    </div>
                  </Match>
                </Switch>

                <footer class="join-server-actions">
                  <Show when={props.step === "waiting" && props.onSetUpWithAgent}>
                    {(setUp) => (
                      <Button variant="secondary" size="lg" fullWidth onClick={() => setUp()()}>
                        {t("server.install.setUpWithAgent")}
                      </Button>
                    )}
                  </Show>
                  <Show
                    when={expired()}
                    fallback={
                      <Button size="lg" fullWidth disabled={props.step !== "connected"} onClick={props.onOpenServer}>
                        {t("server.hosted.open")}
                      </Button>
                    }
                  >
                    <Button size="lg" fullWidth onClick={props.onNewCommand}>
                      {t("server.install.newCommand")}
                    </Button>
                  </Show>
                </footer>
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Copies the command with what an AI agent must know. It sits before Copy, as other code block actions do. */
function CopyForAgentButton(props: { command: string }) {
  const { t } = useText();
  const [copied, setCopied] = createSignal(false);
  let reset: number | undefined;
  onCleanup(() => window.clearTimeout(reset));
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(t("server.install.agentPrompt", { command: props.command }));
    } catch {
      // The clipboard refused the text, so the button does not say Copied.
      setCopied(false);
      return;
    }
    setCopied(true);
    window.clearTimeout(reset);
    reset = window.setTimeout(() => setCopied(false), 2000);
  };
  return (
    <Button type="button" variant="ghost" size="xs" class="message-code-copy" onClick={() => void copy()}>
      <span class="message-code-copy-icons" aria-hidden="true">
        <span data-visible={copied() ? undefined : "true"}>
          <Copy />
        </span>
        <span data-visible={copied() ? "true" : undefined}>
          <Check />
        </span>
      </span>
      <span>{copied() ? t("common.copied") : t("server.install.copyForAgent")}</span>
    </Button>
  );
}
