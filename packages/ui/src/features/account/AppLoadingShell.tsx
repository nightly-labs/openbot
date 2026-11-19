import { useText } from "../../text";

export function AppLoadingShell() {
  const { t } = useText();
  return (
    <main class="app-loading" role="status" aria-live="polite" aria-busy="true">
      <span class="sr-only">{t("webClient.loading")}</span>
    </main>
  );
}
