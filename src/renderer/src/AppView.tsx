import { AppLoadingScreen } from "@openbot/ui/features/account/AppLoadingScreen";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, createSignal, Loading, Show } from "solid-js";
import { useAuth } from "./features/account/account-context";
import { useProviderDetection } from "./features/custom-providers/provider-detection-context";
import { createLanguageStep } from "./features/onboarding/language-step";
import { useSetup } from "./features/onboarding/onboarding-context";
import { SetupReadError } from "./features/onboarding/SetupReadError";
import { useSetupProviderProps } from "./features/onboarding/setup-provider-props";
import { useServerScope } from "./features/servers/server-scope";
import { useServerSelection } from "./features/servers/server-selection";
import { useSettings } from "./features/settings/settings-context";
import { WhatsNewOverlay } from "./features/updates/WhatsNewOverlay";
import { QuitShortcutHint } from "./features/window/QuitShortcutHint";
import { useI18n } from "./i18n-context";
import { AccountLogin, FirstRunFlow, InitialSetup, LanguageStep } from "./lazy-views";
import { usePlatform } from "./platform";
import { reportWorkspaceReady } from "./renderer-timing";
import { WorkspaceShell } from "./WorkspaceShell";

// A server switch mounts this gate again. Only the first splash of a start or a reload plays through.
let startupSplashPlayed = false;

/**
 * Lets the next start fade the splash as soon as the app is ready, as after a server switch.
 * Prototype stories render the whole app on each page load and do not need the crew each time.
 */
export function skipStartupSplash(): void {
  startupSplashPlayed = true;
}

/** The placeholder every lazy view below falls back to while its code loads. */
function LoadingScreen() {
  const { t } = useText();
  return <div class="initial-setup-screen" role="status" aria-label={t("app.loading")} />;
}

/**
 * Which of four things the window shows: the startup splash until the build and
 * the saved setup are known, the sign-in screen (after the language wheel on a
 * computer that has not passed it), one of the two first-run flows, or the
 * workspace. The splash stays over the next screen until it fades out.
 *
 * The ladder is written as nested `<Show>` rather than pushed into the providers
 * as readiness gates. A gated provider withholds its subtree, and the only
 * subtree here is the whole application, so a gate would replace these
 * placeholders with a blank window and serialize the bootstrap loads that
 * currently run in parallel. See `app-providers.tsx`.
 *
 * `account` is threaded down as an accessor because the innermost `<Show>` is
 * what proves it non-null; the workspace and its overlays need the account, and
 * re-reading `signedInAccount()` below would hand them a nullable value the
 * gate has already ruled out.
 */
export function AppAccessGate() {
  const { t } = useText();
  const platform = usePlatform();
  const i18n = useI18n();
  const auth = useAuth();
  const setup = useSetup();
  const scope = useServerScope();
  // Setup actions run against this computer. The view waits for its first status before offering them.
  const setupProviders = useSetupProviderProps();
  const detection = useProviderDetection();
  const settings = useSettings();
  const { joinRemoteDuringSetup } = useServerSelection();
  // The splash also waits for the catalogs of the first language, so the first screen is not in
  // English. A later language change does not bring the splash back.
  const languageLoaded = createMemo<boolean>((was) => was === true || i18n.ready());
  const started = () => setup.setupLoaded() && platform.appInfo() !== null && languageLoaded();
  // The landing demo opens on the workspace at once, with no splash.
  const [splashShown, setSplashShown] = createSignal(!platform.landingPreview);
  // A chat window is a new page too, but it fades as soon as it is ready.
  const splashPlaysThrough = !startupSplashPlayed && platform.chatWindow === null;
  // The splash lets the workspace mount its heavy views before the crew hop out.
  const [splashOpen, setSplashOpen] = createSignal(false);
  const splashMoving = () => splashShown() && !splashOpen();
  // The splash also covers the first load of the workspace, which then shows no screen of its own.
  // On a start or a reload, the crew rain in once and hop out when the workspace is ready.
  const [workspaceReady, setWorkspaceReady] = createSignal(false);
  const workspaceShown = () =>
    !!auth.visibleSignedInAccount() && (setup.setupState()?.completed === true || !scope.connection.hasContent);
  const splashReady = () => started() && (!workspaceShown() || workspaceReady());
  const languageStep = createLanguageStep();
  // Only a settled sign-out: a code in flight or a retry keeps the sign-in screen it belongs to.
  // The language button reopens the wheel from an error too, so that state does not hide it.
  const languageStepShown = () =>
    !languageStep.done() && (languageStep.reopened() || auth.centralAuth().status === "signed_out");
  // A computer signed in before the wheel existed has its language already, so a later sign-out skips the wheel.
  createEffect(
    () => auth.centralAuth().status === "signed_in",
    (signedIn) => {
      if (signedIn && !languageStep.done()) languageStep.complete();
    },
  );
  // A startup mark for `dev:bench`: the first moment the app can leave the splash.
  createEffect(started, (ready) => {
    if (ready) performance.mark("openbot:app-started");
  });
  // For the `system_startup` summary: main reads the time of the main window's first workspace load.
  createEffect(workspaceReady, (ready) => {
    if (ready && platform.chatWindow === null) reportWorkspaceReady();
  });

  return (
    <>
      <Show when={started()}>
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
          !splashShown() &&
          !!auth.visibleSignedInAccount() &&
          (setup.setupState()?.completed === true || !scope.connection.hasContent)
        }
      />
      <QuitShortcutHint />
      <Show when={splashShown()}>
        {/*
          The same pile as the loading screen of a server, so a server that is still loading continues it.
          A start or a reload always shows the crew, also when the app is ready at once.
        */}
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
