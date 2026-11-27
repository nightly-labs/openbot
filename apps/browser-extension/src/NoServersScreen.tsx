import type { CentralAuthUser } from "@openbot/contracts/ipc";
import { Layers } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createSignal } from "solid-js";
import { AccountRow } from "./ConnectingScreen";

export function NoServersScreen(props: { user: CentralAuthUser; onRetry: () => Promise<void>; onSignOut: () => void }) {
  const { t } = useText();
  const [checking, setChecking] = createSignal(false);

  async function retry() {
    setChecking(true);
    try {
      await props.onRetry();
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
        </div>
        <button type="button" class="ext-connect-pill" disabled={checking()} onClick={() => void retry()}>
          {t("common.tryAgain")}
        </button>
      </div>
      <AccountRow user={props.user} onSignOut={props.onSignOut} />
    </div>
  );
}
