/**
 * Signing in to a coding provider with a code instead of this computer's browser.
 *
 * The browser sign-in every provider row offers today hands the account off to whatever browser
 * this computer opens, and comes back through it. That fails wherever the hand-off cannot close -
 * a machine with no browser, a remote session, a browser already signed in to the wrong account.
 * The code flow moves the sign-in to a device the user already trusts: OpenBot asks the provider
 * for a short-lived code, shows it, and waits. The user opens the verification page on a phone or
 * another browser, types the code there, and the provider tells OpenBot it is done.
 *
 * The code on screen is the whole point of the flow and is safe to read out: it is a one-time
 * handle the provider issues, it expires, and it authorises nothing on its own. The token the
 * provider returns for it never reaches this component - the main process keeps it, and what comes
 * back here is a phase and, on success, the account name. So there is nothing here to redact.
 *
 * The dialog covers the waiting only. How the sign-in ended - connected, expired, refused - is a
 * notification, because by then the user has been away on another device and the thing they come
 * back to should not be a modal they have to dismiss before they can use the app.
 *
 * This component decides nothing. It renders one phase of the flow and reports what the user did,
 * because the flow itself lives one side of the IPC boundary away and a dialog that polled would
 * be a second copy of it. That also makes every phase reachable in Storybook.
 */

import {
  Button,
  CopyButton,
  Dialog,
  ExternalLink,
  Field,
  IconButton,
  Input,
  QrCode,
  Spinner,
  Text,
  X,
} from "@openbot/ui";
import { createEffect, createMemo, createSignal, Show } from "solid-js";
import { useText } from "../text";

/**
 * One phase of a code sign-in while it is still running, with the fields only that phase has.
 *
 * A union rather than a record of flags: "waiting" is the only phase that has a code to show. The
 * endings are not here at all - they close this dialog and arrive as a notification.
 */
export type ProviderCodeLoginState =
  /** Asking the provider for a code. Nothing to show yet. */
  | { phase: "starting" }
  /** The code is on screen and the provider has not answered yet. */
  | {
      phase: "waiting";
      /** What the user types on the other device. Shown, copied, and read out loud. */
      userCode: string;
      /** The page the user opens, in the short form that is readable on screen. */
      verificationUrl: string;
      /** The same page with the code already in it, for the QR code. Optional: not every provider issues one. */
      verificationUrlComplete?: string;
      /** Epoch milliseconds. The countdown, and the moment the code stops working. */
      expiresAt: number;
    }
  /**
   * The provider's page shows a code after the user signs in there, and the user pastes it back
   * here (Claude on a host with no visible browser). The pasted code is a credential: it goes to the
   * provider's CLI and is not kept.
   */
  | {
      phase: "paste";
      /** The provider's sign-in page. */
      verificationUrl: string;
      /** Epoch milliseconds. When the host stops waiting for the code. */
      expiresAt: number;
      /** The code is on its way to the provider. */
      submitting?: boolean;
      /** Why the last code did not go through, in the user's words. */
      error?: string;
    }
  /**
   * The provider's page signs its CLI in by itself once the user logs in there (Cursor on a host
   * with no visible browser). There is no code to show or to copy back.
   */
  | {
      phase: "link";
      /** The provider's sign-in page. */
      verificationUrl: string;
      /** Epoch milliseconds. When the host stops waiting for the sign-in. */
      expiresAt: number;
    }
  /** The code was accepted on the other device; OpenBot is finishing the sign-in. */
  | { phase: "verifying" };

export interface ProviderCodeLoginDialogProps {
  open: boolean;
  /** The provider in the user's words, not the CLI's: "ChatGPT", not "Codex". */
  providerName: string;
  state: ProviderCodeLoginState;
  /** Opens the verification page in the browser, for the user who is on this computer after all. */
  onOpenVerificationUrl: (url: string) => void;
  /** Gives up: closes the dialog and abandons the code. */
  onCancel: () => void;
  /** Sends the code a `paste` sign-in's page showed. */
  onSubmitCode?: (code: string) => void;
}

export function ProviderCodeLoginDialog(props: ProviderCodeLoginDialogProps) {
  const { t } = useText();
  const waiting = () => (props.state.phase === "waiting" ? props.state : null);
  const pasting = () => (props.state.phase === "paste" ? props.state : null);
  const linking = () => (props.state.phase === "link" ? props.state : null);
  // The field keeps what the user pasted until the dialog closes, so a refused code can be fixed.
  const [pastedCode, setPastedCode] = createSignal("");
  // A new sign-in has a new page, and the code of the last one is no use to it.
  createEffect(
    () => pasting()?.verificationUrl,
    () => {
      setPastedCode("");
    },
  );
  // The clock only runs while a code is on screen, so an open dialog on any other phase does not
  // wake the view once a second for a label nothing shows.
  const remaining = createCountdown(() => waiting()?.expiresAt ?? pasting()?.expiresAt ?? linking()?.expiresAt ?? null);

  return (
    <Dialog.Root
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onCancel();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay class="provider-code-login-backdrop">
          <Dialog.Content class="provider-code-login-dialog" as="section">
            <header class="provider-code-login-header">
              <Dialog.Title class="provider-code-login-title">
                {linking()
                  ? t("provider.codeLogin.linkTitle", { name: props.providerName })
                  : t("provider.codeLogin.title", { name: props.providerName })}
              </Dialog.Title>
              <Dialog.Description class="provider-code-login-description">
                {t("provider.codeLogin.description")}
              </Dialog.Description>
            </header>

            {/* Each phase carries its own live role, rather than the body being one region. A
              region around the whole thing would announce the countdown once a second. */}
            <div class="provider-code-login-body">
              <Show when={props.state.phase === "starting"}>
                <div class="provider-code-login-pending" role="status">
                  <Spinner size="sm" />
                  <Text as="span" tone="muted">
                    {t("provider.codeLogin.starting", { name: props.providerName })}
                  </Text>
                </div>
              </Show>

              <Show when={waiting()}>
                {(code) => (
                  <div class="provider-code-login-code" role="status">
                    {/* The plain page when the provider issues no pre-filled one, which is the
                      case for ChatGPT: scanning still saves typing the address on the phone, and
                      the code is on this screen to type next to it. */}
                    <QrCode
                      value={code().verificationUrlComplete ?? code().verificationUrl}
                      label={t("provider.codeLogin.qrLabel", { name: props.providerName })}
                      size={160}
                    />

                    <ol class="provider-code-login-steps">
                      <li>
                        <Text as="span">{t("provider.codeLogin.open")}</Text>{" "}
                        <Button
                          class="provider-code-login-url"
                          type="button"
                          variant="link"
                          onClick={() => props.onOpenVerificationUrl(code().verificationUrl)}
                        >
                          {code().verificationUrl}
                          <ExternalLink aria-hidden="true" />
                        </Button>
                      </li>
                      <li>
                        <Text as="span">{t("provider.codeLogin.enterCode")}</Text>
                      </li>
                    </ol>

                    <div class="provider-code-login-value">
                      {/* The code is read one group at a time, because it is about to be typed on
                        another device from this screen alone. */}
                      <output
                        class="provider-code-login-digits"
                        aria-label={t("provider.codeLogin.codeLabel", { code: spellOut(code().userCode) })}
                      >
                        {code().userCode}
                      </output>
                      <CopyButton
                        class="provider-code-login-copy"
                        value={code().userCode}
                        label={t("provider.codeLogin.copyCode")}
                        copiedLabel={t("common.copied")}
                        variant="outline"
                      />
                    </div>

                    {/* Outside the live region the code sits in: a countdown read out every
                      second would bury the code it is counting down. */}
                    <Text class="provider-code-login-expiry" as="p" variant="caption" tone="muted" aria-live="off">
                      <Show when={remaining() > 0} fallback={t("provider.codeLogin.expired")}>
                        {t("provider.codeLogin.expiresIn", { time: formatCountdown(remaining()) })}
                      </Show>
                    </Text>
                  </div>
                )}
              </Show>

              <Show when={pasting()}>
                {(paste) => (
                  <div class="provider-code-login-code">
                    <QrCode
                      value={paste().verificationUrl}
                      label={t("provider.codeLogin.qrLabel", { name: props.providerName })}
                      size={160}
                    />

                    <ol class="provider-code-login-steps">
                      <li>
                        <Text as="span">{t("provider.codeLogin.open")}</Text>{" "}
                        {/* The whole link carries a long sign-in state, so only its page is shown. */}
                        <Button
                          class="provider-code-login-url"
                          type="button"
                          variant="link"
                          onClick={() => props.onOpenVerificationUrl(paste().verificationUrl)}
                        >
                          {shortUrl(paste().verificationUrl)}
                          <ExternalLink aria-hidden="true" />
                        </Button>
                      </li>
                      <li>
                        <Text as="span">{t("provider.codeLogin.pasteStep", { name: props.providerName })}</Text>
                      </li>
                    </ol>

                    <form
                      class="provider-code-login-paste"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const code = pastedCode().trim();
                        if (code && !paste().submitting) props.onSubmitCode?.(code);
                      }}
                    >
                      <Field label={t("provider.codeLogin.pasteLabel")} error={paste().error}>
                        <Input
                          value={pastedCode()}
                          autocomplete="off"
                          spellcheck={false}
                          disabled={paste().submitting}
                          onValueChange={setPastedCode}
                        />
                      </Field>
                      <Button type="submit" disabled={!pastedCode().trim() || paste().submitting}>
                        {t("provider.codeLogin.pasteSubmit")}
                      </Button>
                    </form>

                    <Text class="provider-code-login-expiry" as="p" variant="caption" tone="muted" aria-live="off">
                      <Show when={remaining() > 0} fallback={t("provider.codeLogin.pasteExpired")}>
                        {t("provider.codeLogin.pasteExpiresIn", { time: formatCountdown(remaining()) })}
                      </Show>
                    </Text>
                  </div>
                )}
              </Show>

              <Show when={linking()}>
                {(link) => (
                  <div class="provider-code-login-code" role="status">
                    <QrCode
                      value={link().verificationUrl}
                      label={t("provider.codeLogin.qrLabel", { name: props.providerName })}
                      size={160}
                    />

                    <ol class="provider-code-login-steps">
                      <li>
                        <Text as="span">{t("provider.codeLogin.open")}</Text>{" "}
                        {/* The whole link carries a long sign-in state, so only its page is shown. */}
                        <Button
                          class="provider-code-login-url"
                          type="button"
                          variant="link"
                          onClick={() => props.onOpenVerificationUrl(link().verificationUrl)}
                        >
                          {shortUrl(link().verificationUrl)}
                          <ExternalLink aria-hidden="true" />
                        </Button>
                      </li>
                      <li>
                        <Text as="span">{t("provider.codeLogin.linkStep", { name: props.providerName })}</Text>
                      </li>
                    </ol>

                    <Text class="provider-code-login-expiry" as="p" variant="caption" tone="muted" aria-live="off">
                      <Show when={remaining() > 0} fallback={t("provider.codeLogin.pasteExpired")}>
                        {t("provider.codeLogin.pasteExpiresIn", { time: formatCountdown(remaining()) })}
                      </Show>
                    </Text>
                  </div>
                )}
              </Show>

              <Show when={props.state.phase === "verifying"}>
                <div class="provider-code-login-pending" role="status">
                  <Spinner size="sm" />
                  <Text as="span" tone="muted">
                    {t("provider.codeLogin.verifying", { name: props.providerName })}
                  </Text>
                </div>
              </Show>
            </div>

            {/* Last in the order, first in the corner: the dialog opens on the code, not on the way out. */}
            <IconButton
              class="provider-code-login-close"
              label={t("provider.codeLogin.closeLabel", { name: props.providerName })}
              variant="ghost"
              data-cuelume-tap="close"
              onClick={props.onCancel}
            >
              <X />
            </IconButton>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Seconds left until `deadline`, ticking while there is one, and 0 when there is not. */
function createCountdown(deadline: () => number | null) {
  const [now, setNow] = createSignal(Date.now());

  createEffect(
    () => deadline(),
    (until) => {
      if (until === null) return;
      setNow(Date.now());
      if (until <= Date.now()) return;
      const clock = window.setInterval(() => {
        setNow(Date.now());
        // Stop at the deadline rather than wait for the next state change: the label has reached
        // zero and no later tick can change it.
        if (Date.now() >= until) window.clearInterval(clock);
      }, 1_000);
      return () => window.clearInterval(clock);
    },
  );

  return createMemo(() => {
    const until = deadline();
    return until === null ? 0 : Math.max(0, Math.ceil((until - now()) / 1_000));
  });
}

/** The host and path of a link, without the query that carries its sign-in state. */
function shortUrl(url: string): string {
  const parsed = new URL(url);
  return `${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`;
}

function formatCountdown(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds % 60).toString().padStart(2, "0")}`;
}

/**
 * The code as separate characters, for the accessible name.
 *
 * "KTQ4B62MX" is read as a word by most screen readers, and a word is not what the user has to type
 * on the other device.
 */
function spellOut(code: string): string {
  return [...code].join(" ");
}
