import { AppLogo } from "@openbot/brand";
import type { AppVariant } from "@openbot/contracts/ipc";
import { useText } from "../../text";

const PRODUCT_NAME = "OpenBot";

export function AppLoadingScreen(props: { variant: AppVariant }) {
  const { t } = useText();
  return (
    <main class="account-login-screen app-loading-screen" role="status" aria-live="polite">
      <div class="account-login-shell">
        <header class="account-login-brand-lockup">
          <AppLogo variant={props.variant} animation="look-around" class="account-login-logo" />
          <span class="account-login-wordmark">{PRODUCT_NAME}</span>
        </header>
        <div class="app-loading-indicator">
          <span class="app-loading-track" aria-hidden="true">
            <span class="app-loading-bar" />
          </span>
          <p class="app-loading-label">{t("webClient.loading")}</p>
        </div>
      </div>
    </main>
  );
}
