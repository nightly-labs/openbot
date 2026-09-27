import { useText } from "@openbot/ui/text";
import { Loading, Show } from "solid-js";
import { useAuth } from "./features/account/account-context";
import { useProviderDetection } from "./features/custom-providers/provider-detection-context";
import { useSetup } from "./features/onboarding/onboarding-context";
import { useSetupProviderProps } from "./features/onboarding/setup-provider-props";
import { useServerSelection } from "./features/servers/server-selection";
import { AccountLogin, InitialSetup, OnboardingFlow } from "./lazy-views";
import { usePlatform } from "./platform";
import { WorkspaceShell } from "./WorkspaceShell";

/** The one placeholder every gate below falls back to, at every depth. */
function LoadingScreen() {
  const { t } = useText();
  return <div class="initial-setup-screen" role="status" aria-label={t("app.loading")} />;
}

/**
 * Which of four things the window shows: a placeholder until the build and the
 * saved setup are known, the sign-in screen, one of the two first-run flows, or
 * the workspace.
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
  const platform = usePlatform();
  const auth = useAuth();
  const setup = useSetup();
  // Setup is ungated: it only ever runs against this computer, so there is no remote server to hide
  // the endpoints from. Settings gates on `activeServer()`; see `WorkspaceOverlays.tsx`.
  const setupProviders = useSetupProviderProps();
  const detection = useProviderDetection();
  const { joinRemoteDuringSetup } = useServerSelection();

  return (
    <Show when={setup.setupLoaded() && platform.appInfo() !== null} fallback={<LoadingScreen />}>
      <Show
        when={auth.visibleSignedInAccount()}
        fallback={
          <Loading fallback={<LoadingScreen />}>
            <AccountLogin
              variant={platform.appInfo()?.variant ?? "production"}
              state={auth.centralAuth()}
              onRetry={auth.retryCentralAccount}
              onRequestEmailCode={auth.requestEmailCode}
              onVerifyEmailCode={auth.verifyEmailCode}
              onReset={auth.logoutCentralAccount}
            />
          </Loading>
        }
      >
        {(account) => (
          <Show
            when={setup.setupState()?.completed}
            fallback={
              <Show
                when={setup.pendingInviteUrl().trim()}
                fallback={
                  <Loading fallback={<LoadingScreen />}>
                    <OnboardingFlow
                      {...setupProviders}
                      state={setup.setupState() ?? { completed: false, preferredProvider: null, preferredModel: null }}
                      platform={platform.appInfo()?.platform ?? "darwin"}
                      onSave={setup.saveSetup}
                      onProviderStepShown={detection.scanOnce}
                    />
                  </Loading>
                }
              >
                <Loading fallback={<LoadingScreen />}>
                  <InitialSetup
                    {...setupProviders}
                    state={setup.setupState() ?? { completed: false, preferredProvider: null, preferredModel: null }}
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
            }
          >
            <WorkspaceShell account={account} />
          </Show>
        )}
      </Show>
    </Show>
  );
}
