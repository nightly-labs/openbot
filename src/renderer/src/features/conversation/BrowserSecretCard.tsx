import type { BrowserTakeoverRequest, RespondToBrowserSecretInput } from "@openbot/contracts/ipc";
import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { Button, Input } from "../../components/ui";

export function BrowserSecretCard(props: {
  request: BrowserTakeoverRequest;
  onRespond: (input: RespondToBrowserSecretInput) => Promise<void>;
}) {
  const [value, setValue] = createSignal("");
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal("");
  const method = () => props.request.secret?.method;
  const digits = () => props.request.secret?.digits ?? 6;
  const password = () => method() === "password";
  const title = () =>
    password()
      ? "Enter your password"
      : method() === "authenticator"
        ? "Enter your authenticator code"
        : "Enter your one-time code";
  const valid = () => (password() ? value().length > 0 : value().length === digits());
  onCleanup(() => setValue(""));
  createEffect(
    () => props.request.requestId,
    () => {
      setValue("");
      setError("");
    },
  );
  const respond = async (decision: "submit" | "cancel" | "takeover") => {
    if (pending() || (decision === "submit" && !valid())) return;
    setPending(true);
    setError("");
    const identity = { requestId: props.request.requestId, agentId: props.request.agentId };
    const input: RespondToBrowserSecretInput =
      decision === "submit" ? { ...identity, decision, secret: value() } : { ...identity, decision };
    setValue("");
    try {
      await props.onRespond(input);
    } catch {
      setError("The request could not be completed. Check the connection and try again.");
    } finally {
      if (input.decision === "submit") input.secret = "";
      setPending(false);
    }
  };
  return (
    <form
      class="conversation-interaction-card browser-secret-card"
      aria-label="Secure authentication"
      aria-busy={pending() ? "true" : "false"}
      onSubmit={(event) => {
        event.preventDefault();
        void respond("submit");
      }}
    >
      <header class="conversation-interaction-header">
        <h2>{title()}</h2>
      </header>
      <p>
        Submit once to <strong>{props.request.secret?.origin}</strong>
      </p>
      <p>
        {method() === "authenticator"
          ? "Use the code from your authenticator app."
          : password()
            ? "Your password goes directly to this site."
            : "Use the code sent by email or text message."}{" "}
        This value is not added to chat.
      </p>
      <label>
        <span>{password() ? "Password" : `${digits()}-digit code`}</span>
        <div class="browser-secret-input" data-code={!password() || undefined}>
          <Input
            aria-label={password() ? "Password" : `${digits()}-digit code`}
            type="password"
            inputmode={password() ? "text" : "numeric"}
            autocomplete={password() ? "off" : "one-time-code"}
            maxlength={password() ? 4096 : digits()}
            value={value()}
            disabled={pending()}
            onInput={(event) =>
              setValue(
                password()
                  ? event.currentTarget.value
                  : event.currentTarget.value.replace(/[^0-9]/gu, "").slice(0, digits()),
              )
            }
          />
          <Show when={!password()}>
            <div class="browser-secret-digits" aria-hidden="true">
              <For each={Array.from({ length: digits() })}>
                {(_, index) => <span>{value().length > index() ? "•" : "–"}</span>}
              </For>
            </div>
          </Show>
        </div>
      </label>
      <Show when={error()}>
        <p role="alert">{error()}</p>
      </Show>
      <footer class="browser-takeover-actions">
        <Button type="submit" disabled={pending() || !valid()}>
          {pending() ? "Submitting…" : "Submit"}
        </Button>
        <Button type="button" variant="secondary" disabled={pending()} onClick={() => void respond("cancel")}>
          Cancel
        </Button>
        <Button type="button" variant="secondary" disabled={pending()} onClick={() => void respond("takeover")}>
          Take over
        </Button>
      </footer>
    </form>
  );
}
