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
import {
  McpSignInPage,
  McpSignInPageNote,
  type McpSignInPageSource,
  McpSignInRelayControls,
  type McpSignInRelaySource,
  relayDescriptionKey,
} from "../features/settings/McpSignInPage";
import { useText } from "../text";

export type ProviderCodeLoginState =
  | { phase: "starting" }
  | {
      phase: "waiting";
      userCode: string;
      verificationUrl: string;
      verificationUrlComplete?: string;
      expiresAt: number;
    }
  | {
      phase: "paste";
      verificationUrl: string;
      expiresAt: number;
      submitting?: boolean;
      error?: string;
    }
  | {
      phase: "link";
      verificationUrl: string;
      expiresAt: number;
      onThisComputer?: true;
    }
  | {
      phase: "page";
      hostName: string;
      page: McpSignInPageSource | null;
    }
  | {
      phase: "relay";
      hostName: string;
      page: McpSignInRelaySource | null;
    }
  | { phase: "address" }
  | { phase: "verifying" };

export interface ProviderCodeLoginDialogProps {
  open: boolean;
  providerName: string;
  state: ProviderCodeLoginState;
  onOpenVerificationUrl: (url: string) => void;
  onCancel: () => void;
  setupStep?: string | undefined;
  onSubmitCode?: (code: string) => void;
  onOpenRelayPage?: () => Promise<void>;
  onPasteRelayAddress?: (address: string) => Promise<void>;
}

export function ProviderCodeLoginDialog(props: ProviderCodeLoginDialogProps) {
  const { t } = useText();
  const waiting = () => (props.state.phase === "waiting" ? props.state : null);
  const pasting = () => (props.state.phase === "paste" ? props.state : null);
  const linking = () => (props.state.phase === "link" ? props.state : null);
  const linkOnThisComputer = () => linking()?.onThisComputer === true;
  const hostPage = () => (props.state.phase === "page" ? props.state : null);
  const relay = () => (props.state.phase === "relay" ? props.state : null);
  const addressPaste = () => props.state.phase === "address";
  const [pastedCode, setPastedCode] = createSignal("");
  createEffect(
    () => pasting()?.verificationUrl,
    () => {
      setPastedCode("");
    },
  );
  const descriptionText = () => {
    if (addressPaste()) return t("provider.codeLogin.addressDescription");
    const host = hostPage();
    if (host) return t("provider.codeLogin.pageDescription", { host: host.hostName });
    if (linkOnThisComputer()) return t("provider.codeLogin.thisComputerDescription");
    const relayed = relay();
    if (!relayed) return t("provider.codeLogin.description");
    if (!relayed.page)
      return t("provider.codeLogin.relayStarting", { name: props.providerName, host: relayed.hostName });
    return t(relayDescriptionKey(relayed.page), { page: relayed.page.authorizeHost, host: relayed.hostName });
  };
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
          <Dialog.Content class="provider-code-login-dialog" data-page={hostPage() ? "" : undefined} as="section">
            <header class="provider-code-login-header">
              <Dialog.Title class="provider-code-login-title">
                {linking() && !linkOnThisComputer()
                  ? t("provider.codeLogin.linkTitle", { name: props.providerName })
                  : hostPage() || relay() || linking() || addressPaste()
                    ? t("provider.codeLogin.pageTitle", { name: props.providerName })
                    : t("provider.codeLogin.title", { name: props.providerName })}
              </Dialog.Title>
              <Dialog.Description class="provider-code-login-description">{descriptionText()}</Dialog.Description>
            </header>

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
                    <QrCode
                      value={code().verificationUrlComplete ?? code().verificationUrl}
                      label={t("provider.codeLogin.qrLabel", { name: props.providerName })}
                      size={160}
                    />

                    <ol class="provider-code-login-steps">
                      <Show when={props.setupStep}>
                        {(step) => (
                          <li>
                            <Text as="span">{step()}</Text>
                          </li>
                        )}
                      </Show>
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
                    <Show when={!link().onThisComputer}>
                      <QrCode
                        value={link().verificationUrl}
                        label={t("provider.codeLogin.qrLabel", { name: props.providerName })}
                        size={160}
                      />
                    </Show>

                    <ol class="provider-code-login-steps">
                      <li>
                        <Text as="span">{t("provider.codeLogin.open")}</Text>{" "}
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

                    <Show when={link().onThisComputer}>
                      <CopyButton
                        class="provider-code-login-copy"
                        value={link().verificationUrl}
                        label={t("provider.codeLogin.copyLink")}
                        copiedLabel={t("common.copied")}
                        variant="outline"
                      />
                    </Show>

                    <Text class="provider-code-login-expiry" as="p" variant="caption" tone="muted" aria-live="off">
                      <Show when={remaining() > 0} fallback={t("provider.codeLogin.pasteExpired")}>
                        {t("provider.codeLogin.pasteExpiresIn", { time: formatCountdown(remaining()) })}
                      </Show>
                    </Text>
                  </div>
                )}
              </Show>

              <Show when={hostPage()}>
                {(host) => (
                  <Show
                    when={host().page}
                    fallback={
                      <div class="provider-code-login-pending" role="status">
                        <Spinner size="sm" />
                        <Text as="span" tone="muted">
                          {t("provider.codeLogin.pageOpening", { name: props.providerName, host: host().hostName })}
                        </Text>
                      </div>
                    }
                  >
                    {(page) => (
                      <>
                        <McpSignInPage page={page()} />
                        <McpSignInPageNote hostName={host().hostName} />
                      </>
                    )}
                  </Show>
                )}
              </Show>

              <Show when={relay()}>
                {(relayed) => (
                  <Show
                    when={relayed().page}
                    fallback={
                      <div class="provider-code-login-pending" role="status">
                        <Spinner size="sm" />
                      </div>
                    }
                  >
                    {(page) => (
                      <>
                        <McpSignInRelayControls
                          page={page()}
                          onOpen={() => props.onOpenRelayPage?.()}
                          onPaste={(address) => props.onPasteRelayAddress?.(address) ?? Promise.resolve()}
                        />
                        <McpSignInPageNote hostName={relayed().hostName} />
                      </>
                    )}
                  </Show>
                )}
              </Show>

              <Show when={addressPaste()}>
                <McpSignInRelayControls
                  page={BROWSER_ADDRESS_PAGE}
                  onPaste={(address) => props.onPasteRelayAddress?.(address) ?? Promise.resolve()}
                />
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

const BROWSER_ADDRESS_PAGE: McpSignInRelaySource = { authorizeHost: "", url: null, listening: true, pasteable: true };

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

function shortUrl(url: string): string {
  const parsed = new URL(url);
  return `${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`;
}

function formatCountdown(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds % 60).toString().padStart(2, "0")}`;
}

function spellOut(code: string): string {
  return [...code].join(" ");
}
