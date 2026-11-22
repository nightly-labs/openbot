import { Button, Input, LogIn } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createSignal, createUniqueId, Show } from "solid-js";

export interface BrowserHttpSignInBarProps {
  /** The host of the site that asks, such as `files.example.com`. */
  site: string;
  refused: boolean;
  onSubmit: (username: string, password: string) => Promise<void>;
  onCancel: () => Promise<void>;
}

/** The sign-in that a site asks for in its own prompt (HTTP Basic or Digest), above the page. */
export function BrowserHttpSignInBar(props: BrowserHttpSignInBarProps) {
  const { t, errorMessage } = useText();
  const id = createUniqueId();
  const [username, setUsername] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal<string | undefined>(undefined);
  const run = async (action: () => Promise<void>) => {
    setPending(true);
    setError(undefined);
    try {
      await action();
    } catch (failure) {
      setError(errorMessage(failure, t("browser.signIn.failed")));
    } finally {
      setPassword("");
      setPending(false);
    }
  };
  const notice = () => error() ?? (props.refused ? t("browser.httpSignIn.refused") : undefined);
  return (
    <form
      class="browser-http-sign-in"
      aria-labelledby={`${id}-title`}
      aria-describedby={notice() ? `${id}-notice` : `${id}-description`}
      novalidate
      onSubmit={(event) => {
        event.preventDefault();
        if (pending() || (!username() && !password())) return;
        void run(() => props.onSubmit(username(), password()));
      }}
    >
      <div class="browser-http-sign-in-text">
        <LogIn aria-hidden="true" />
        <span>
          <strong id={`${id}-title`}>{t("browser.httpSignIn.title", { site: props.site })}</strong>{" "}
          <Show when={notice()} fallback={<span id={`${id}-description`}>{t("browser.httpSignIn.description")}</span>}>
            {(text) => (
              <span id={`${id}-notice`} class="browser-http-sign-in-error" role="alert">
                {text()}
              </span>
            )}
          </Show>
        </span>
      </div>
      <div class="browser-http-sign-in-fields">
        <label class="sr-only" for={`${id}-username`}>
          {t("browser.httpSignIn.username")}
        </label>
        <Input
          id={`${id}-username`}
          size="sm"
          autocomplete="off"
          autocapitalize="none"
          spellcheck={false}
          placeholder={t("browser.httpSignIn.username")}
          value={username()}
          disabled={pending()}
          onValueChange={setUsername}
        />
        <label class="sr-only" for={`${id}-password`}>
          {t("browser.httpSignIn.password")}
        </label>
        <Input
          id={`${id}-password`}
          type="password"
          size="sm"
          autocomplete="off"
          placeholder={t("browser.httpSignIn.password")}
          value={password()}
          invalid={props.refused && !error()}
          disabled={pending()}
          onValueChange={setPassword}
        />
        <Button type="button" variant="ghost" size="sm" disabled={pending()} onClick={() => void run(props.onCancel)}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" size="sm" loading={pending()} disabled={!username() && !password()}>
          {t("browser.httpSignIn.submit")}
        </Button>
      </div>
    </form>
  );
}
