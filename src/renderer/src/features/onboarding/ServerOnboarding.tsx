import type { AgentModelId, AgentProviderId } from "@openbot/contracts/ipc";
import { Button, ErrorReference, IconButton, X } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createSignal, createUniqueId, onSettled, Show } from "solid-js";
import { listenForEscape } from "./onboarding-escape";
import { createSetupProviders, SetupProviderPicker, type SetupProviderProps } from "./SetupProviderPicker";
import { createSetupNext } from "./setup-next";

export interface ServerOnboardingProps {
  serverName: string;
  setup: SetupProviderProps;
  onContinue: (provider: AgentProviderId, model: AgentModelId | null) => void;
  onClose?: (() => void) | undefined;
}

export function ServerOnboarding(props: ServerOnboardingProps) {
  const { t } = useText();
  const [screenElement, setScreenElement] = createSignal<HTMLElement | undefined>();
  const providers = createSetupProviders(props.setup);
  const next = createSetupNext(providers);
  const reasonId = createUniqueId();

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
            <ErrorReference reference={providers.errorReference()} />
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
