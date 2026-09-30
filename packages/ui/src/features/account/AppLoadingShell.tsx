import { useText } from "../../text";

/**
 * The background of the app loading screen, without the crew. The server sends it: the Bloub library
 * that draws the crew runs only in the browser, so the Worker must never import `AppLoadingScreen`.
 */
export function AppLoadingShell() {
  const { t } = useText();
  return (
    <main class="app-loading" role="status" aria-live="polite" aria-busy="true">
      <span class="sr-only">{t("webClient.loading")}</span>
    </main>
  );
}
