import type { BrowserTakeoverRequest, RespondToBrowserSecretInput } from "@openbot/contracts/ipc";
import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import { Button, Input } from "../../components/ui";
import { OtpInput } from "../../components/ui/otp-input";

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
      <Show
        when={password()}
        fallback={
          <div class="browser-secret-code">
            <span class="browser-secret-label">{digits()}-digit code</span>
            <OtpInput
              value={value()}
              length={digits()}
              numeric
              masked
              label={`${digits()}-digit code`}
              status={pending() ? "verifying" : error() ? "error" : "idle"}
              errorMessage={error()}
              onChange={(next) => {
                setValue(next);
                setError("");
              }}
            />
          </div>
        }
      >
        <label class="browser-secret-password">
          <span class="browser-secret-label">Password</span>
          <Input
            aria-label="Password"
            type="password"
            autocomplete="off"
            maxlength={4096}
            value={value()}
            disabled={pending()}
            invalid={Boolean(error())}
            onInput={(event) => {
              setValue(event.currentTarget.value);
              setError("");
            }}
          />
        </label>
        <Show when={error()}>
          <p class="browser-secret-error" role="alert">
            {error()}
          </p>
        </Show>
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
