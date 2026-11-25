import { Button, Eye, EyeOff, Field, Input, Lock, X } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createSignal, createUniqueId, onSettled, Show, untrack } from "solid-js";
import { useBrowserPageCover } from "./browser-page-cover";

export interface BrowserHttpSignInPopoverProps {
  site: string;
  refused: boolean;
  username: string;
  onUsernameChange: (username: string) => void;
  onSubmit: (username: string, password: string) => Promise<void>;
  onCancel: () => Promise<void>;
}

function focusIsFree(): boolean {
  const active = document.activeElement;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return false;
  return !(active instanceof HTMLElement && active.isContentEditable);
}

export function BrowserHttpSignInPopover(props: BrowserHttpSignInPopoverProps) {
  const { t, errorMessage } = useText();
  const id = createUniqueId();
  const [username, setUsername] = createSignal(untrack(() => props.username));
  const [password, setPassword] = createSignal("");
  const [shown, setShown] = createSignal(false);
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal<string | undefined>(undefined);
  let usernameInput: HTMLInputElement | undefined;
  useBrowserPageCover(() => true);
  onSettled(() => {
    if (usernameInput?.checkVisibility() && focusIsFree()) usernameInput.focus();
  });
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
  const cancel = () => {
    if (!pending()) void run(props.onCancel);
  };
  const fieldError = () => error() ?? (props.refused ? t("browser.httpSignIn.refused") : undefined);
  return (
    <form
      class="browser-http-sign-in"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      novalidate
      onSubmit={(event) => {
        event.preventDefault();
        if (pending() || (!username() && !password())) return;
        void run(() => props.onSubmit(username(), password()));
      }}
      onKeyDown={(event: KeyboardEvent) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        cancel();
      }}
    >
      <div class="browser-http-sign-in-head">
        <Lock aria-hidden="true" />
        <div class="browser-http-sign-in-heading">
          <strong id={`${id}-title`}>{t("browser.httpSignIn.title", { site: props.site })}</strong>
          <span id={`${id}-description`}>{t("browser.httpSignIn.description")}</span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={t("common.cancel")}
          title={t("common.cancel")}
          data-cuelume-tap="close"
          disabled={pending()}
          onClick={cancel}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
      <Field label={t("browser.httpSignIn.username")}>
        <Input
          ref={(element: HTMLInputElement) => {
            usernameInput = element;
          }}
          size="sm"
          autocomplete="off"
          autocapitalize="none"
          spellcheck={false}
          value={username()}
          disabled={pending()}
          onValueChange={(value: string) => {
            setUsername(value);
            props.onUsernameChange(value);
          }}
        />
      </Field>
      <Field label={t("browser.httpSignIn.password")} error={fieldError()}>
        <div class="browser-http-sign-in-password">
          <Input
            type={shown() ? "text" : "password"}
            size="sm"
            autocomplete="off"
            value={password()}
            disabled={pending()}
            onValueChange={setPassword}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            class="browser-http-sign-in-reveal"
            aria-label={shown() ? t("vault.hidePassword") : t("vault.showPassword")}
            aria-pressed={shown() ? "true" : "false"}
            onClick={() => setShown((value) => !value)}
          >
            <Show when={shown()} fallback={<Eye aria-hidden="true" />}>
              <EyeOff aria-hidden="true" />
            </Show>
          </Button>
        </div>
      </Field>
      <Button
        type="submit"
        size="sm"
        class="browser-http-sign-in-submit"
        loading={pending()}
        disabled={!username() && !password()}
      >
        {t("browser.httpSignIn.submit")}
      </Button>
    </form>
  );
}
