import type { CentralAuthUser } from "@openbot/contracts/ipc";
import { Layers } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createSignal, Show } from "solid-js";
import { AccountRow } from "./ConnectingScreen";

export function NoServersScreen(props: { user: CentralAuthUser; onRetry: () => Promise<void>; onSignOut: () => void }) {
  const { t } = useText();
  const [checking, setChecking] = createSignal(false);
  const [failure, setFailure] = createSignal<string | null>(null);

  async function retry() {
    setChecking(true);
    setFailure(null);
    try {
      await props.onRetry();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : t("extension.connection.requestFailed"));
    } finally {
      setChecking(false);
    }
  }

  return (
    <div class="ext-connect">
      <header class="ext-connect-head">
        <h1 class="ext-connect-title">{t("extension.connection.servers")}</h1>
      </header>
      <div class="ext-connect-empty">
        <span class="ext-connect-empty-mark">
          <Layers size={28} stroke-width={1.6} aria-hidden="true" />
        </span>
        <div class="ext-connect-empty-text">
          <h2 class="ext-connect-empty-title">{t("extension.connection.noServersTitle")}</h2>
          <p class="ext-connect-caption">{t("extension.connection.noServers")}</p>
          <Show when={failure()}>
            {(message) => (
              <p class="ext-connect-caption" data-failed="" role="alert">
                {message()}
              </p>
            )}
          </Show>
        </div>
        <button type="button" class="ext-connect-pill" disabled={checking()} onClick={() => void retry()}>
          {t("common.tryAgain")}
        </button>
      </div>
      <AccountRow user={props.user} onSignOut={props.onSignOut} />
    </div>
  );
}
