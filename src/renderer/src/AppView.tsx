import { AppLoadingScreen } from "@openbot/ui/features/account/AppLoadingScreen";
import { UpdateRequiredScreen } from "@openbot/ui/features/updates/UpdateRequiredScreen";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, createSignal, Loading, Show } from "solid-js";
import { appPort } from "./app-port";
import { useAuth } from "./features/account/account-context";
import { useProviderDetection } from "./features/custom-providers/provider-detection-context";
import { createLanguageStep } from "./features/onboarding/language-step";
import { useSetup } from "./features/onboarding/onboarding-context";
import { SetupReadError } from "./features/onboarding/SetupReadError";
import { useSetupProviderProps } from "./features/onboarding/setup-provider-props";
import { useServerScope } from "./features/servers/server-scope";
import { useServerSelection } from "./features/servers/server-selection";
import { useSettings } from "./features/settings/settings-context";
import { useUpdates } from "./features/updates/updates-context";
import { WhatsNewOverlay } from "./features/updates/WhatsNewOverlay";
import { QuitShortcutHint } from "./features/window/QuitShortcutHint";
import { useI18n } from "./i18n-context";
import { AccountLogin, FirstRunFlow, InitialSetup, LanguageStep } from "./lazy-views";
import { usePlatform } from "./platform";
import { reportWorkspaceReady } from "./renderer-timing";
import { WorkspaceShell } from "./WorkspaceShell";

let startupSplashPlayed = false;

export function skipStartupSplash(): void {
  startupSplashPlayed = true;
}

function LoadingScreen() {
  const { t } = useText();
  return <div class="initial-setup-screen" role="status" aria-label={t("app.loading")} />;
}

export function AppAccessGate() {
  const { t } = useText();
  const platform = usePlatform();
  const i18n = useI18n();
  const auth = useAuth();
  const setup = useSetup();
  const scope = useServerScope();
  const setupProviders = useSetupProviderProps();
  const detection = useProviderDetection();
  const settings = useSettings();
  const { joinRemoteDuringSetup } = useServerSelection();
  const updates = useUpdates();
  const [requiredUpdateDismissed, setRequiredUpdateDismissed] = createSignal(false);
  const updateRequired = () => updates.status().requiredVersion !== undefined && !requiredUpdateDismissed();
  const languageLoaded = createMemo<boolean>((was) => was === true || i18n.ready());
  const started = () => setup.setupLoaded() && platform.appInfo() !== null && languageLoaded();
  const [splashShown, setSplashShown] = createSignal(!platform.landingPreview);
  const splashPlaysThrough = !startupSplashPlayed && platform.chatWindow === null;
  const [splashOpen, setSplashOpen] = createSignal(false);
  const splashMoving = () => splashShown() && !splashOpen();
  const [workspaceReady, setWorkspaceReady] = createSignal(false);
  const workspaceShown = () =>
    !!auth.visibleSignedInAccount() && (setup.setupState()?.completed === true || !scope.connection.hasContent);
  const splashReady = () =>
    started() && auth.centralAuth().status !== "loading" && (!workspaceShown() || workspaceReady() || updateRequired());
  const languageStep = createLanguageStep();
  const languageStepShown = () =>
    !languageStep.done() && (languageStep.reopened() || auth.centralAuth().status === "signed_out");
  createEffect(
    () => auth.centralAuth().status === "signed_in",
    (signedIn) => {
      if (signedIn && !languageStep.done()) languageStep.complete();
    },
  );
  createEffect(started, (ready) => {
    if (ready) performance.mark("openbot:app-started");
  });
  createEffect(workspaceReady, (ready) => {
    if (ready && platform.chatWindow === null) reportWorkspaceReady();
  });

  return (
    <>
      <Show when={started() && updateRequired()}>
        <UpdateRequiredScreen
          status={updates.status()}
          logoVariant={platform.appInfo()?.variant ?? "production"}
          onUpdate={updates.runAction}
          onOpenDownloadPage={() => void appPort().openExternal("download")}
          onDismiss={() => setRequiredUpdateDismissed(true)}
        />
      </Show>
      <Show when={started() && !updateRequired()}>
        <Show
          when={auth.visibleSignedInAccount()}
          fallback={
            <Loading fallback={<LoadingScreen />}>
              <Show
                when={languageStepShown()}
                fallback={
                  <AccountLogin
                    variant={platform.appInfo()?.variant ?? "production"}
                    state={auth.centralAuth()}
                    onRetry={auth.retryCentralAccount}
                    onRequestEmailCode={auth.requestEmailCode}
                    onVerifyEmailCode={auth.verifyEmailCode}
                    onReset={auth.logoutCentralAccount}
                    onOpenCompanySignIn={auth.openCompanySignIn}
                    language={i18n.locale()}
                    onChangeLanguage={languageStep.reopen}
                  />
                }
              >
                <LanguageStep
                  variant={platform.appInfo()?.variant ?? "production"}
                  reopened={languageStep.reopened()}
                  onDone={languageStep.complete}
                />
              </Show>
            </Loading>
          }
        >
          {(account) => (
            <Show
              when={setup.setupState()?.completed}
              fallback={
                <Show
                  when={scope.connection.hasContent}
                  fallback={
                    <WorkspaceShell
                      account={account}
                      behindSplash={splashMoving}
                      onStartupReady={() => setWorkspaceReady(true)}
                    />
                  }
                >
                  <Show when={!setup.setupReadFailed()} fallback={<SetupReadError />}>
                    <Show
                      when={setup.pendingInviteUrl().trim()}
                      fallback={
                        <Loading fallback={<LoadingScreen />}>
                          <FirstRunFlow
                            {...setupProviders}
                            state={
                              setup.setupState() ?? { completed: false, preferredProvider: null, preferredModel: null }
                            }
                            platform={platform.appInfo()?.platform ?? "darwin"}
                            onSave={setup.saveSetup}
                            onAnalyticsChoice={(enabled, chosen) =>
                              settings.updateGeneralSettings(
                                { ...settings.generalSettings(), productAnalytics: enabled },
                                { analyticsChosen: chosen },
                              )
                            }
                            onProviderStepShown={detection.scanOnce}
                            logoVariant={platform.appInfo()?.variant ?? "production"}
                          />
                        </Loading>
                      }
                    >
                      <Loading fallback={<LoadingScreen />}>
                        <InitialSetup
                          {...setupProviders}
                          state={
                            setup.setupState() ?? { completed: false, preferredProvider: null, preferredModel: null }
                          }
                          platform={platform.appInfo()?.platform ?? "darwin"}
                          accountEmail={account().email}
                          inviteUrl={setup.pendingInviteUrl()}
                          onSave={setup.saveSetup}
                          onPreviewInvite={setup.previewInvite}
                          onJoinRemote={joinRemoteDuringSetup}
                          onLogout={auth.logoutCentralAccount}
                        />
                      </Loading>
                    </Show>
                  </Show>
                </Show>
              }
            >
              <WorkspaceShell
                account={account}
                behindSplash={splashMoving}
                onStartupReady={() => setWorkspaceReady(true)}
              />
            </Show>
          )}
        </Show>
      </Show>
      <WhatsNewOverlay
        ready={
          !platform.chatWindow &&
          !updateRequired() &&
          !splashShown() &&
          !!auth.visibleSignedInAccount() &&
          (setup.setupState()?.completed === true || !scope.connection.hasContent)
        }
      />
      <QuitShortcutHint />
      <Show when={splashShown()}>
        <AppLoadingScreen
          label={t("app.loading")}
          ready={splashReady()}
          quickExit={!splashPlaysThrough}
          onMountViews={() => setSplashOpen(true)}
          onExited={() => {
            startupSplashPlayed = true;
            setSplashShown(false);
          }}
        />
      </Show>
    </>
  );
}
