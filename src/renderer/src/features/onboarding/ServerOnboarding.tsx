import type { AgentModelId, AgentProviderId } from "@openbot/contracts/ipc";
import { Button, IconButton, X } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createSignal, createUniqueId, onSettled, Show } from "solid-js";
import { listenForEscape } from "./onboarding-escape";
import { createSetupProviders, SetupProviderPicker, type SetupProviderProps } from "./SetupProviderPicker";
import { createSetupNext } from "./setup-next";

export interface ServerOnboardingProps {
  /** The joined server, as the user named it. */
  serverName: string;
  /** The providers of the server's host. */
  setup: SetupProviderProps;
  /**
   * Opens the agent form on the chosen provider. The model is `null` for a built-in provider, which
   * keeps its own default, and names an endpoint when the user chose their own.
   */
  onContinue: (provider: AgentProviderId, model: AgentModelId | null) => void;
  /**
   * Goes back to the server that was open before, from the close button or Escape. With no other
   * server, the screen has no close.
   */
  onClose?: (() => void) | undefined;
}

/**
 * The provider step of a joined server that has no agent yet, for its owner or admin.
 *
 * OpenBot includes no AI subscription, and a new host has no provider signed in, so an agent made
 * there first could not answer. The step signs the host in, and the agent form comes after it.
 * The choice stays in this window: the saved setup choice is of this computer, not of the server.
 * The step covers the window, as the first-run screen does: the rail and the sidebar of a server
 * with no agent have nothing to use yet.
 */
export function ServerOnboarding(props: ServerOnboardingProps) {
  const { t } = useText();
  // The row menus mount here, as on the first-run screen.
  const [screenElement, setScreenElement] = createSignal<HTMLElement | undefined>();
  const providers = createSetupProviders(props.setup);
  const next = createSetupNext(providers);
  const reasonId = createUniqueId();

  // The sign-in dialog, the add server dialog and a row menu close on Escape themselves.
  onSettled(() => listenForEscape(() => props.onClose));

  function continueToAgent(): void {
    const provider = providers.selectedProvider();
    if (!provider || !providers.selectedProviderConnected()) {
      next.connectSelected();
      return;
    }
    props.onContinue(provider, providers.customSelected() ? providers.customModel() : null);
  }

  return (
    <main
      class="onboarding-screen server-onboarding-screen"
      aria-labelledby="server-onboarding-title"
      ref={(element) => setScreenElement(element)}
    >
      <Show when={props.onClose}>
        {(close) => (
          <IconButton class="server-onboarding-close" label={t("common.close")} variant="ghost" onClick={close()}>
            <X />
          </IconButton>
        )}
      </Show>
      <div class="onboarding-shell">
        <section class="onboarding-panel">
          <h1 id="server-onboarding-title">{t("onboarding.server.title", { server: props.serverName })}</h1>
          <p class="onboarding-description">{t("onboarding.server.description")}</p>
          <div class="onboarding-provider">
            <SetupProviderPicker
              providers={providers}
              ariaLabel={t("onboarding.server.label")}
              label={t("onboarding.server.label")}
              hint={t("onboarding.server.hint")}
              disabled={false}
              menuMount={screenElement()}
            />
          </div>
        </section>

        <Show when={providers.error()}>
          <p class="onboarding-error" role="alert">
            {providers.error()}
          </p>
        </Show>

        <div class="onboarding-actions">
          <Button
            type="button"
            variant="default"
            class="onboarding-next"
            aria-describedby={next.blockedReason() ? reasonId : undefined}
            onClick={continueToAgent}
          >
            {providers.selectedProviderConnected() ? t("onboarding.server.continue") : t("onboarding.action.connect")}
          </Button>
          <Show when={next.blockedReason()}>
            {(reason) => (
              <p class="onboarding-next-reason" id={reasonId}>
                {reason()}
              </p>
            )}
          </Show>
        </div>
      </div>
    </main>
  );
}
