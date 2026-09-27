import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  AGENT_PROVIDERS,
  type AgentModelId,
  type AgentProviderId,
  type AppSetupState,
  agentProviderName,
  type DesktopPlatform,
  type InvitePreview,
  type JoinServerInput,
} from "@openbot/contracts/ipc";
import { Button, Dialog, Textarea } from "@openbot/ui";
import { InvitePreviewCard } from "@openbot/ui/features/servers/JoinServerDialog";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, createSignal, onSettled, Show, untrack } from "solid-js";
import { ComputerUseSetup } from "../computer-use/ComputerUseSetup";
import {
  createSetupProviders,
  SetupProviderPicker,
  type SetupProviderProps,
  savedCustomModel,
} from "./SetupProviderPicker";

interface InitialSetupProps extends SetupProviderProps {
  reviewing?: boolean;
  state: AppSetupState;
  platform: DesktopPlatform;
  accountEmail: string;
  inviteUrl?: string;
  /**
   * Records the choice. An omitted model keeps the saved one while the provider stays the same;
   * `null` clears it; the custom row names the endpoint model that new agents start on.
   */
  onSave: (provider: AgentProviderId, model?: AgentModelId | null) => Promise<void>;
  onPreviewInvite: (input: JoinServerInput) => Promise<InvitePreview>;
  onJoinRemote: (input: JoinServerInput, provider: AgentProviderId) => Promise<void>;
  onLogout?: () => Promise<void>;
  onClose?: () => void;
}

type SetupRoute = "local" | "remote";

const PROVIDERS: Array<{ id: AgentProviderId; name: string }> = AGENT_PROVIDERS.map((id) => ({
  id,
  name: agentProviderName(id),
}));

const TEXT_MARKER = "\u0000";

export function InitialSetup(props: InitialSetupProps) {
  const { t, errorMessage } = useText();
  const initialInviteUrl = untrack(() => props.inviteUrl?.trim() ?? "");
  const [route, setRoute] = createSignal<SetupRoute | null>(
    untrack(() => (props.reviewing ? "local" : initialInviteUrl ? "remote" : null)),
  );
  /**
   * The saved endpoint model, when the saved choice is the custom row. The state is the one saved
   * when the screen opened; the endpoint list can load later.
   */
  const savedState = untrack(() => props.state);
  const savedEndpointModel = createMemo(() =>
    savedCustomModel(savedState.preferredProvider, savedState.preferredModel, props.customProviders),
  );
  /**
   * Stays true once the saved model is known to be an endpoint's. A removal of that endpoint then
   * empties `savedEndpointModel`, but the save must still clear the model.
   */
  let savedModelIsEndpoint = false;
  createEffect(savedEndpointModel, (model) => {
    if (model) savedModelIsEndpoint = true;
  });
  const providers = createSetupProviders(props, {
    provider: savedState.preferredProvider,
    customModel: savedEndpointModel,
  });
  const selectedProvider = providers.selectedProvider;
  const setError = providers.setError;
  const error = providers.error;
  /** The screen sits on the dialog layer, so the row menus mount in it rather than behind it. */
  const [dialogElement, setDialogElement] = createSignal<HTMLElement | undefined>();
  const [saving, setSaving] = createSignal(false);
  const [inviteUrl, setInviteUrl] = createSignal(initialInviteUrl);
  const [invitePreview, setInvitePreview] = createSignal<InvitePreview | null>(null);
  createEffect(
    () => props.inviteUrl?.trim() ?? "",
    (nextInviteUrl) => {
      if (!nextInviteUrl || nextInviteUrl === inviteUrl()) return;
      setInviteUrl(nextInviteUrl);
      setInvitePreview(null);
      setRoute("remote");
      void previewRemote(nextInviteUrl);
    },
  );

  onSettled(() => {
    if (initialInviteUrl) void previewRemote(initialInviteUrl);
  });

  function chooseRoute(nextRoute: SetupRoute): void {
    providers.clearErrors();
    setRoute(nextRoute);
  }

  async function saveLocal(): Promise<void> {
    const provider = selectedProvider();
    if (!provider || saving()) return;
    setSaving(true);
    setError("");
    try {
      // The custom row names its model. A built-in row keeps the saved model, unless the saved
      // model was the custom row's: the user chose another row, so that model must go.
      await props.onSave(
        provider,
        providers.customSelected() ? providers.customModel() : savedModelIsEndpoint ? null : undefined,
      );
    } catch (cause) {
      setError(errorMessage(cause, t("onboarding.setup.saveFailed")));
      setSaving(false);
    }
  }

  async function previewRemote(value = inviteUrl().trim()): Promise<boolean> {
    if (!value || saving()) return false;
    setSaving(true);
    setError("");
    try {
      setInvitePreview(await props.onPreviewInvite({ inviteUrl: value }));
      return true;
    } catch (cause) {
      setInvitePreview(null);
      setError(errorMessage(cause, t("onboarding.setup.verifyFailed")));
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function connectRemote(): Promise<void> {
    const provider = selectedProvider() ?? "codex";
    if (saving()) return;
    if (!invitePreview()) {
      await previewRemote();
      return;
    }
    setSaving(true);
    setError("");
    try {
      await props.onJoinRemote({ inviteUrl: inviteUrl().trim() }, provider);
    } catch (cause) {
      setError(errorMessage(cause, t("onboarding.setup.connectFailed")));
      setSaving(false);
    }
  }

  const joinNoteParts = () => {
    const [before = "", after = ""] = t("onboarding.setup.joinNote", { email: TEXT_MARKER }).split(TEXT_MARKER);
    return [before, after] as const;
  };

  /** "ChatGPT, Claude, or Grok", built from the registry so a new provider joins the sentence. */
  function providerSentence(): string {
    const names = PROVIDERS.map((provider) => provider.name);
    const last = names[names.length - 1];
    return names.length < 2
      ? (last ?? "")
      : t("onboarding.setup.providerList", {
          providers: names.slice(0, -1).join(t("onboarding.setup.providerSeparator")),
          last: last ?? "",
        });
  }

  const title = () => {
    if (props.reviewing) return t("onboarding.setup.reviewTitle");
    if (route() === "local") return t("onboarding.setup.localTitle");
    if (route() === "remote") return t("onboarding.setup.remoteTitle");
    return t("onboarding.setup.title");
  };

  const description = () => {
    if (props.reviewing) {
      return t("onboarding.setup.reviewDescription");
    }
    if (route() === "local") {
      return t("onboarding.setup.localDescription");
    }
    if (route() === "remote") {
      return t("onboarding.setup.remoteDescription");
    }
    return t("onboarding.setup.description");
  };

  return (
    <Dialog.Root open onOpenChange={(open) => !open && props.onClose?.()}>
      <main class="initial-setup-screen">
        <Dialog.Content as="section" class="initial-setup" data-dialog-surface="unstyled" ref={setDialogElement}>
          <header class="initial-setup-header">
            <div class="initial-setup-account-row">
              <Show when={!props.reviewing && route()}>
                <Button
                  variant="ghost"
                  type="button"
                  class="initial-setup-back"
                  aria-label={t("onboarding.setup.back")}
                  onClick={() => {
                    providers.clearErrors();
                    setRoute(null);
                  }}
                >
                  <svg viewBox="0 0 20 20" aria-hidden="true">
                    <path d="m12.5 4.5-5 5 5 5" />
                  </svg>
                </Button>
              </Show>
              <span class="initial-setup-account">
                <i aria-hidden="true" />
                {props.accountEmail}
              </span>
              <Show when={props.onLogout}>
                <Button
                  variant="ghost"
                  type="button"
                  class="initial-setup-signout"
                  onClick={() => void props.onLogout?.()}
                >
                  {t("onboarding.setup.signOut")}
                </Button>
              </Show>
            </div>
            <p class="initial-setup-eyebrow">{t("onboarding.setup.eyebrow")}</p>
            <Dialog.Title as="h1" id="initial-setup-title">
              {title()}
            </Dialog.Title>
            <Dialog.Description as="p" id="initial-setup-description" class="initial-setup-intro">
              {description()}
            </Dialog.Description>
          </header>

          <Show when={!props.reviewing && route() === null}>
            <ul class="setup-route-list" aria-label={t("onboarding.setup.connectionType")}>
              <li>
                <Button variant="ghost" type="button" class="setup-route-button" onClick={() => chooseRoute("local")}>
                  <span class="setup-route-icon setup-route-icon-local" aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <title>{t("onboarding.setup.localIcon")}</title>
                      <rect x="3" y="4" width="18" height="13" rx="2.5" />
                      <path d="M8 21h8M12 17v4" />
                    </svg>
                    <i />
                  </span>
                  <span class="setup-route-copy">
                    <strong>{t("onboarding.setup.localRoute")}</strong>
                    <small>{t("onboarding.setup.localRouteDetail", { providers: providerSentence() })}</small>
                  </span>
                  <RouteArrow />
                </Button>
              </li>
              <li>
                <Button variant="ghost" type="button" class="setup-route-button" onClick={() => chooseRoute("remote")}>
                  <span class="setup-route-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <title>{t("onboarding.setup.remoteIcon")}</title>
                      <rect x="3" y="3" width="18" height="7" rx="2.5" />
                      <rect x="3" y="14" width="18" height="7" rx="2.5" />
                      <path d="M7 6.5h.01M7 17.5h.01" />
                    </svg>
                    <i />
                  </span>
                  <span class="setup-route-copy">
                    <strong>{t("onboarding.setup.remoteTitle")}</strong>
                    <small>{t("onboarding.setup.remoteRouteDetail")}</small>
                  </span>
                  <RouteArrow />
                </Button>
              </li>
            </ul>
          </Show>

          <Show when={route() === "local"}>
            <div class="setup-local-content">
              <SetupProviderPicker
                providers={providers}
                ariaLabel={t("onboarding.setup.defaultProvider")}
                label={t("onboarding.setup.defaultProvider")}
                hint={t("onboarding.setup.defaultProviderHint")}
                disabled={saving()}
                menuMount={dialogElement()}
              />

              <ComputerUseSetup variant="compact" />
            </div>
          </Show>

          <Show when={!props.reviewing && route() === "remote"}>
            <form
              class="setup-remote-form"
              onSubmit={(event) => {
                event.preventDefault();
                void connectRemote();
              }}
            >
              <Show
                when={invitePreview()}
                fallback={
                  <label>
                    <span>{t("onboarding.setup.invitation")}</span>
                    <Textarea
                      rows="3"
                      maxlength={INPUT_LIMITS.inviteUrl}
                      value={inviteUrl()}
                      onValueChange={(value) => {
                        setInviteUrl(value);
                        setInvitePreview(null);
                        setError("");
                      }}
                      placeholder={t("onboarding.setup.invitationPlaceholder")}
                      spellcheck={false}
                      autofocus
                      required
                    />
                  </label>
                }
              >
                {(preview) => (
                  <>
                    <InvitePreviewCard preview={preview()} accountEmail={props.accountEmail} />
                    <Button
                      variant="ghost"
                      type="button"
                      class="setup-remote-change"
                      disabled={saving()}
                      onClick={() => {
                        setInvitePreview(null);
                        setError("");
                      }}
                    >
                      {t("onboarding.setup.otherInvitation")}
                    </Button>
                  </>
                )}
              </Show>
              <Show when={!invitePreview()}>
                <p class="setup-remote-note">
                  {joinNoteParts()[0]}
                  <strong>{props.accountEmail}</strong>
                  {joinNoteParts()[1]}
                </p>
              </Show>
            </form>
          </Show>

          <Show when={error()}>
            <p class="initial-setup-error" role="alert">
              {error()}
            </p>
          </Show>

          <Show when={route() !== null}>
            <div class="initial-setup-actions">
              <Show when={props.reviewing}>
                <Button variant="ghost" type="button" class="initial-setup-secondary" onClick={props.onClose}>
                  {t("common.cancel")}
                </Button>
              </Show>
              <Button
                variant="default"
                type="button"
                class="initial-setup-save"
                disabled={
                  saving() ||
                  (route() === "local" && !selectedProvider()) ||
                  (route() === "remote" && !inviteUrl().trim())
                }
                onClick={() => (route() === "local" ? void saveLocal() : void connectRemote())}
              >
                {saving()
                  ? route() === "remote"
                    ? t("common.connecting")
                    : t("common.saving")
                  : props.reviewing
                    ? t("onboarding.setup.saveChanges")
                    : route() === "remote"
                      ? invitePreview()
                        ? t("onboarding.setup.connect")
                        : t("onboarding.setup.reviewInvitation")
                      : selectedProvider()
                        ? t("onboarding.setup.continueWith", {
                            provider: providers.customSelected()
                              ? t("provider.custom.name")
                              : providerName(selectedProvider()),
                          })
                        : t("onboarding.setup.chooseProvider")}
              </Button>
            </div>
          </Show>
        </Dialog.Content>
      </main>
    </Dialog.Root>
  );
}

function RouteArrow() {
  return (
    <svg class="setup-route-arrow ui-glyph-20" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4 10h11M11 6l4 4-4 4" />
    </svg>
  );
}

function providerName(provider: AgentProviderId | null): string {
  return provider === null ? agentProviderName("codex") : agentProviderName(provider);
}
