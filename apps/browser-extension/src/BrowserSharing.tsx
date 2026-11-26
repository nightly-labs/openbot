import { Button, CreditCard, Download, Globe2, KeyRound, LogIn } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createSignal, For, Match, onSettled, Show, Switch } from "solid-js";
import { track } from "./analytics";
import {
  ASKS_KEY,
  type AskChoice,
  BROWSER_ANSWER_MESSAGE,
  type BrowserAsk,
  decodeAsks,
  decodeSites,
  SITES_KEY,
} from "./client-browser-messages";

function storedValue<T>(key: string, decode: (value: unknown) => T, initial: T): () => T {
  const [value, setValue] = createSignal<{ current: T }>({ current: initial });
  onSettled(() => {
    const read = () =>
      void chrome.storage.local.get(key).then(
        (items) => setValue({ current: decode(items[key]) }),
        () => undefined,
      );
    const changed = (changes: { [name: string]: chrome.storage.StorageChange }) => {
      if (key in changes) read();
    };
    read();
    chrome.storage.onChanged.addListener(changed);
    return () => chrome.storage.onChanged.removeListener(changed);
  });
  return () => value().current;
}

export const siteName = (origin: string) => (URL.canParse(origin) ? new URL(origin).host : origin);

export function useAllowedSites(): () => string[] {
  return storedValue(SITES_KEY, decodeSites, []);
}

export async function removeAllowedSite(site: string): Promise<void> {
  const stored = (await chrome.storage.local.get(SITES_KEY))[SITES_KEY];
  const kept = Object.fromEntries(decodeSites(stored).flatMap((entry) => (entry === site ? [] : [[entry, "always"]])));
  await chrome.storage.local.set({ [SITES_KEY]: kept });
  void track("browser_sharing_action", { action: "site_removed" });
}

function actionWords(ask: BrowserAsk, t: ReturnType<typeof useText>["t"]): string {
  const detail = ask.detail;
  switch (ask.action) {
    case "open":
      return t("extension.browser.action.open", { detail });
    case "navigate":
      if (detail === "back") return t("extension.browser.action.back");
      if (detail === "forward") return t("extension.browser.action.forward");
      if (detail === "reload") return t("extension.browser.action.reload");
      return t("extension.browser.action.navigate", { detail });
    case "snapshot":
      return t("extension.browser.action.snapshot");
    case "screenshot":
      return t("extension.browser.action.screenshot");
    case "click":
      return t("extension.browser.action.click", { detail });
    case "type":
      return t("extension.browser.action.type", { detail });
    case "press":
      return t("extension.browser.action.press", { detail });
    case "scroll":
      return t("extension.browser.action.scroll");
    case "wait_for":
      return t("extension.browser.action.waitFor");
    case "close_tab":
      return t("extension.browser.action.closeTab");
  }
}

function askTitle(ask: BrowserAsk, t: ReturnType<typeof useText>["t"]): string {
  const values = { agent: ask.agentName, site: siteName(ask.site) };
  switch (ask.kind) {
    case "site":
      return t("extension.browser.ask.site", values);
    case "password":
      return t("extension.browser.ask.password", values);
    case "payment":
      return t("extension.browser.ask.payment", values);
    case "download":
      return t("extension.browser.ask.download", values);
    case "sign-in":
      return t("extension.browser.ask.signIn", values);
  }
}

function AskCard(props: { ask: BrowserAsk; onAnswer: (choice: AskChoice) => void }) {
  const { t } = useText();
  const sensitive = () => props.ask.kind !== "site";
  return (
    <article class="ext-ask" data-kind={props.ask.kind} aria-label={askTitle(props.ask, t)}>
      <header class="ext-ask-head">
        <span class="ext-ask-mark" aria-hidden="true">
          <Switch fallback={<Globe2 size={16} />}>
            <Match when={props.ask.kind === "password"}>
              <KeyRound size={16} />
            </Match>
            <Match when={props.ask.kind === "payment"}>
              <CreditCard size={16} />
            </Match>
            <Match when={props.ask.kind === "download"}>
              <Download size={16} />
            </Match>
            <Match when={props.ask.kind === "sign-in"}>
              <LogIn size={16} />
            </Match>
          </Switch>
        </span>
        <h2 class="ext-ask-title">{askTitle(props.ask, t)}</h2>
      </header>
      <p class="ext-ask-action" dir="auto">
        {props.ask.kind === "download" && props.ask.detail ? props.ask.detail : actionWords(props.ask, t)}
      </p>
      <Show when={sensitive()}>
        <p class="ext-ask-note">
          {props.ask.kind === "sign-in" ? `${t("extension.browser.ask.signInNote")} ` : ""}
          {t("extension.browser.ask.alwaysNote")}
        </p>
      </Show>
      <div class="ext-ask-buttons">
        <Button variant="secondary" size="sm" onClick={() => props.onAnswer("deny")}>
          {t("extension.browser.ask.deny")}
        </Button>
        <Show when={!sensitive()}>
          <Button variant="secondary" size="sm" onClick={() => props.onAnswer("always")}>
            {t("extension.browser.ask.allowAlways")}
          </Button>
        </Show>
        <Button size="sm" onClick={() => props.onAnswer("once")}>
          {t("extension.browser.ask.allowOnce")}
        </Button>
      </div>
    </article>
  );
}

export function BrowserAsks() {
  const { t } = useText();
  const asks = storedValue(ASKS_KEY, decodeAsks, []);
  const [answered, setAnswered] = createSignal<ReadonlySet<string>>(new Set());
  const shown = () => asks().filter((ask) => !answered().has(ask.id));
  function answer(ask: BrowserAsk, choice: AskChoice) {
    setAnswered((current) => new Set([...current, ask.id]));
    void chrome.runtime.sendMessage({ kind: BROWSER_ANSWER_MESSAGE, id: ask.id, choice }).catch(() => undefined);
  }
  return (
    <Show when={shown().length > 0}>
      <section class="ext-asks" aria-label={t("extension.browser.asks")} aria-live="polite">
        <For each={shown()}>{(ask) => <AskCard ask={ask} onAnswer={(choice) => answer(ask, choice)} />}</For>
      </section>
    </Show>
  );
}
