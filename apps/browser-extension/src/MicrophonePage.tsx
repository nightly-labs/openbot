import { Button } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createSignal, onSettled, Show } from "solid-js";

export function MicrophonePage() {
  const { t } = useText();
  const [state, setState] = createSignal<"asking" | "allowed" | "blocked">("asking");

  async function ask() {
    setState("asking");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      for (const track of stream.getTracks()) track.stop();
      setState("allowed");
      const tab = await chrome.tabs.getCurrent();
      if (tab?.id !== undefined) await chrome.tabs.remove(tab.id);
    } catch {
      setState("blocked");
    }
  }
  onSettled(() => void ask());

  return (
    <main class="account-login-screen">
      <div class="account-login-shell">
        <section class="account-login" aria-labelledby="microphone-title">
          <h1 id="microphone-title" class="account-login-title">
            {t("extension.microphone.title")}
          </h1>
          <p class="account-login-description" role="status">
            {state() === "allowed"
              ? t("extension.microphone.allowed")
              : state() === "blocked"
                ? t("extension.microphone.blocked")
                : t("extension.microphone.asking")}
          </p>
          <Show when={state() === "blocked"}>
            <div class="account-login-form">
              <Button variant="default" type="button" class="account-login-primary" onClick={() => void ask()}>
                {t("extension.microphone.retry")}
              </Button>
            </div>
          </Show>
        </section>
      </div>
    </main>
  );
}
