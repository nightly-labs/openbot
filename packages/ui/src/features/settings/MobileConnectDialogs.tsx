import { AppLogo, type MobilePlatformLogoVariant, PlatformLogo } from "@openbot/brand";
import type { AppTextKey } from "@openbot/i18n";
import {
  ArrowLeft,
  ArrowRight,
  Button,
  Check,
  CircleCheck,
  CopyButton,
  Dialog,
  Download,
  Eye,
  EyeOff,
  IconButton,
  Link2,
  Lock,
  QrCode,
  Scan,
  ShieldCheck,
  SlidingTabs,
  Text,
  X,
} from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createEffect, createSignal, For, Match, onCleanup, Show, Switch } from "solid-js";
import { useText } from "../../text";
import { ANDROID_PLAY_STORE_URL } from "../mobile-app/android-play-store";
import { IOS_APP_STORE_URL } from "../mobile-app/ios-app-store";
import type { SettingsMobileConnectStore } from "./stores/mobile-connect-store";

type Store = SettingsMobileConnectStore;

const QR_SIZE = 176;
/** How long a dialog shows the phone that connected before it closes. */
const CONNECTED_CLOSE_MS = 1_400;
/** The permanent code hides itself after this, so it does not stay on the screen. */
const LINK_VISIBLE_SECONDS = 60;

interface PhoneApp {
  platform: MobilePlatformLogoVariant;
  label: string;
  url: string;
  qrLabel: AppTextKey;
  tag: AppTextKey;
}

/** The store page of each phone app. Its QR code opens the store on the phone. */
const PHONE_APPS: readonly PhoneApp[] = [
  {
    platform: "ios",
    label: "iPhone",
    url: IOS_APP_STORE_URL,
    qrLabel: "settings.mobileConnect.iosApp.qrLabel",
    tag: "settings.mobileConnect.qr.appStore",
  },
  {
    platform: "android",
    label: "Android",
    url: ANDROID_PLAY_STORE_URL,
    qrLabel: "settings.mobileConnect.androidApp.qrLabel",
    tag: "settings.mobileConnect.qr.playStore",
  },
];

function countdown(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** The tag under each code: what the code does, in words and with an icon. */
function QrTag(props: { kind: "store" | "signin" | "permanent" | "success" | "idle"; children: JSX.Element }) {
  return (
    <span class="settings-mobile-qr-tag" data-kind={props.kind}>
      <Switch>
        <Match when={props.kind === "store"}>
          <Download aria-hidden="true" />
        </Match>
        <Match when={props.kind === "signin"}>
          <Scan aria-hidden="true" />
        </Match>
        <Match when={props.kind === "permanent"}>
          <Lock aria-hidden="true" />
        </Match>
        <Match when={props.kind === "success"}>
          <Check aria-hidden="true" />
        </Match>
      </Switch>
      {props.children}
    </span>
  );
}

/** A code, the success mark over it when a phone connected, and its tag. */
function CodeStage(props: { value: string; label: string; connected: boolean; tag: JSX.Element }) {
  return (
    <div class="settings-mobile-qr">
      <div class="settings-mobile-connect-qr-stage" data-success={props.connected ? "" : undefined}>
        <QrCode class="settings-mobile-qr-code" value={props.value} size={QR_SIZE} label={props.label}>
          <AppLogo variant="production" class="settings-mobile-app-qr-logo" />
        </QrCode>
        <Show when={props.connected}>
          <div class="settings-mobile-connect-success-mark" aria-hidden="true">
            <CircleCheck />
          </div>
        </Show>
      </div>
      {props.tag}
    </div>
  );
}

/** Where a code appears when there is none. The same size as the code, so nothing moves. */
function CodeSlot(props: { children: JSX.Element }) {
  return (
    <div class="settings-mobile-qr">
      <div class="settings-mobile-qr-slot" style={{ width: `${QR_SIZE}px`, height: `${QR_SIZE}px` }}>
        {props.children}
      </div>
    </div>
  );
}

function DialogFrame(props: { open: boolean; title: string; onClose: () => void; children: JSX.Element }) {
  const { t } = useText();
  return (
    <Dialog.Root
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay class="ui-confirm-dialog-overlay">
          <Dialog.Content as="section" class="ui-dialog-content settings-mobile-dialog">
            <header class="settings-mobile-dialog-header">
              <Dialog.Title as="h2" class="settings-mobile-dialog-title">
                {props.title}
              </Dialog.Title>
              <IconButton label={t("common.close")} variant="ghost" onClick={() => props.onClose()}>
                <X />
              </IconButton>
            </header>
            {props.children}
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Captures the phone that connected, and closes the dialog a moment later. */
function createConnectedClose(source: () => { name: string; value: string } | null, close: () => void) {
  const [connected, setConnected] = createSignal<{ name: string; value: string } | null>(null);
  createEffect(source, (found) => {
    if (found) setConnected(found);
  });
  createEffect(connected, (found) => {
    if (!found) return;
    const timer = window.setTimeout(close, CONNECTED_CLOSE_MS);
    return () => window.clearTimeout(timer);
  });
  return [connected, setConnected] as const;
}

type AddScreen = "ask" | "install" | "signin";

/**
 * Adds a phone in steps, with one code per step: the store code to get the app, or the one-time
 * sign-in code. Closing the dialog cancels a code that no phone used.
 */
export function MobileConnectAddPhoneDialog(props: {
  open: boolean;
  store: Store;
  canCancelTicket: boolean;
  onClose: () => void;
}) {
  const { t } = useText();
  const [screen, setScreen] = createSignal<AddScreen>("ask");
  const [platform, setPlatform] = createSignal<MobilePlatformLogoVariant>("ios");
  const session = () => props.store.state.connect.session;
  const live = () => {
    const current = session();
    return Boolean(current && !current.collapsing && !current.successDeviceName && !props.store.expired());
  };
  // A code that no phone used is cancelled when its screen closes, also when it arrives after that.
  createEffect(
    () => !(props.open && screen() === "signin") && live() && !props.store.state.connect.busy && props.canCancelTicket,
    (cancel) => {
      if (cancel) void props.store.cancelTicket();
    },
  );
  const close = () => {
    setScreen("ask");
    setConnected(null);
    props.onClose();
  };
  const [connected, setConnected] = createConnectedClose(() => {
    const current = session();
    return props.open && current?.successDeviceName
      ? { name: current.successDeviceName, value: current.ticket.qrData }
      : null;
  }, close);
  const toSignIn = () => {
    setScreen("signin");
    if (!live()) void props.store.createTicket();
  };
  const back = () => setScreen("ask");
  const app = () => PHONE_APPS.find((candidate) => candidate.platform === platform()) ?? PHONE_APPS[0];
  const title = () => {
    if (screen() === "install") return t("settings.mobileConnect.add.install.heading");
    if (screen() === "signin") return t("settings.mobileConnect.signIn.title");
    return t("settings.mobileConnect.add.title");
  };

  return (
    <DialogFrame open={props.open} title={title()} onClose={close}>
      <Show when={screen()} keyed>
        {(current) => (
          <div class="settings-mobile-dialog-body settings-mobile-enter">
            <Switch>
              <Match when={current === "ask"}>
                <Text variant="body-sm" tone="secondary">
                  {t("settings.mobileConnect.add.question")}
                </Text>
                <div class="settings-mobile-choices">
                  <Button type="button" variant="outline" class="settings-mobile-choice" onClick={toSignIn}>
                    <Scan aria-hidden="true" />
                    <span class="settings-mobile-choice-text">
                      <span class="settings-mobile-choice-title">{t("settings.mobileConnect.add.signIn.title")}</span>
                      <span class="settings-mobile-choice-hint">{t("settings.mobileConnect.add.signIn.hint")}</span>
                    </span>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    class="settings-mobile-choice"
                    onClick={() => setScreen("install")}
                  >
                    <Download aria-hidden="true" />
                    <span class="settings-mobile-choice-text">
                      <span class="settings-mobile-choice-title">{t("settings.mobileConnect.add.install.title")}</span>
                      <span class="settings-mobile-choice-hint">{t("settings.mobileConnect.add.install.hint")}</span>
                    </span>
                  </Button>
                </div>
              </Match>
              <Match when={current === "install"}>
                <SlidingTabs.Root
                  value={platform()}
                  onChange={(value) => {
                    if (value === "ios" || value === "android") setPlatform(value);
                  }}
                >
                  <SlidingTabs.List aria-label={t("settings.mobileConnect.install.platformLabel")}>
                    <For each={PHONE_APPS}>
                      {(phone) => (
                        <SlidingTabs.Trigger class="settings-mobile-app-tab" value={phone.platform}>
                          <PlatformLogo platform={phone.platform} />
                          {phone.label}
                        </SlidingTabs.Trigger>
                      )}
                    </For>
                  </SlidingTabs.List>
                </SlidingTabs.Root>
                <Show when={app()} keyed>
                  {(phone) => (
                    <div class="settings-mobile-qr">
                      <QrCode class="settings-mobile-qr-code" value={phone.url} size={QR_SIZE} label={t(phone.qrLabel)}>
                        <PlatformLogo platform={phone.platform} class="settings-mobile-app-qr-platform" />
                      </QrCode>
                      <QrTag kind="store">{t(phone.tag)}</QrTag>
                    </div>
                  )}
                </Show>
                <Text variant="caption" tone="muted" class="settings-mobile-dialog-note">
                  {t("settings.mobileConnect.add.install.note")}
                </Text>
              </Match>
              <Match when={current === "signin"}>
                <SignInCode store={props.store} connected={connected()} live={live()} />
              </Match>
            </Switch>
          </div>
        )}
      </Show>
      <Show when={screen() !== "ask"}>
        <footer class="settings-mobile-dialog-footer">
          <Button type="button" variant="ghost" onClick={back}>
            <ArrowLeft aria-hidden="true" />
            {t("common.back")}
          </Button>
          <Switch>
            <Match when={screen() === "install"}>
              <Button type="button" onClick={toSignIn}>
                {t("settings.mobileConnect.add.continue")}
                <ArrowRight aria-hidden="true" />
              </Button>
            </Match>
            <Match when={screen() === "signin" && live()}>
              <Button
                type="button"
                size="sm"
                variant="destructive-ghost"
                loading={props.store.state.connect.cancelling}
                disabled={!props.canCancelTicket || props.store.state.connect.busy}
                onClick={() => void props.store.cancelTicket()}
              >
                {t("settings.mobileConnect.code.cancel")}
              </Button>
            </Match>
          </Switch>
        </footer>
      </Show>
    </DialogFrame>
  );
}

/** The one-time code with its countdown, the phone that it connected, or a way to get a new code. */
function SignInCode(props: { store: Store; connected: { name: string; value: string } | null; live: boolean }) {
  const { t } = useText();
  return (
    <>
      <Switch
        fallback={
          <CodeSlot>
            <Show
              when={!props.store.state.connect.busy}
              fallback={
                <Text variant="caption" tone="muted" role="status">
                  {t("settings.mobileConnect.generating")}
                </Text>
              }
            >
              <Text variant="caption" tone="muted">
                {props.store.expired()
                  ? t("settings.mobileConnect.code.expired")
                  : t("settings.mobileConnect.code.none")}
              </Text>
              <Button size="xs" variant="outline" type="button" onClick={() => void props.store.createTicket()}>
                {t("settings.mobileConnect.code.new")}
              </Button>
            </Show>
          </CodeSlot>
        }
      >
        <Match when={props.connected}>
          {(connected) => (
            <div aria-live="polite">
              <CodeStage
                value={connected().value}
                label={t("settings.mobileConnect.qrLabel")}
                connected
                tag={
                  <span role="status">
                    <QrTag kind="success">{t("settings.mobileConnect.qr.connected", { name: connected().name })}</QrTag>
                  </span>
                }
              />
            </div>
          )}
        </Match>
        <Match when={props.live && props.store.state.connect.session}>
          {(session) => (
            <>
              <CodeStage
                value={session().ticket.qrData}
                label={t("settings.mobileConnect.qrLabel")}
                connected={false}
                tag={
                  <QrTag kind="signin">
                    {t("settings.mobileConnect.qr.signIn")}
                    <span class="settings-mobile-qr-tag-time">{props.store.expiryLabel()}</span>
                  </QrTag>
                }
              />
              <ol class="settings-mobile-steps">
                <li>{t("settings.mobileConnect.step.open")}</li>
                <li>{t("settings.mobileConnect.step.scan")}</li>
                <li>{t("settings.mobileConnect.step.point")}</li>
              </ol>
            </>
          )}
        </Match>
      </Switch>
      <Show when={props.store.state.connect.error}>
        {(error) => (
          <Text class="settings-modal-error" variant="caption" role="alert">
            {error()}
          </Text>
        )}
      </Show>
    </>
  );
}

/**
 * The permanent link: what it is and a way to make one, or its code with a warning. The code shows
 * when the dialog opens, and hides when the dialog closes or after a minute.
 */
export function MobileConnectLinkDialog(props: { open: boolean; store: Store; onClose: () => void }) {
  const { t } = useText();
  const link = () => props.store.state.link;
  const hide = () => {
    if (link().revealed) props.store.toggleLinkRevealed();
  };
  const close = () => {
    hide();
    setConnected(null);
    props.onClose();
  };
  const [connected, setConnected] = createConnectedClose(() => {
    const name = link().successDeviceName;
    const url = link().link?.url;
    return props.open && name && url ? { name, value: url } : null;
  }, close);
  createEffect(
    () => props.open && Boolean(link().link),
    (show) => {
      if (show && !link().revealed) props.store.toggleLinkRevealed();
    },
  );

  return (
    <DialogFrame open={props.open} title={t("settings.mobileConnect.link.title")} onClose={close}>
      <div class="settings-mobile-dialog-body">
        <Show
          when={link().link}
          fallback={
            <div class="settings-mobile-link-intro">
              <span class="settings-mobile-phones-empty-icon" aria-hidden="true">
                <Link2 />
              </span>
              <Text variant="body-sm" class="settings-mobile-phone-name">
                {t("settings.mobileConnect.link.intro.title")}
              </Text>
              <Text variant="caption" tone="muted">
                {t("settings.mobileConnect.link.intro.description")}
              </Text>
              <Button
                type="button"
                size="sm"
                loading={link().busy === "create"}
                loadingLabel={t("settings.mobileConnect.generating")}
                disabled={!link().loaded || link().busy !== null}
                onClick={() => void props.store.createLink()}
              >
                {t("settings.mobileConnect.link.create")}
              </Button>
            </div>
          }
        >
          {(current) => (
            <Show
              when={connected() || link().revealed}
              fallback={
                <CodeSlot>
                  <Text variant="caption" tone="muted">
                    {t("settings.mobileConnect.link.hidden")}
                  </Text>
                  <Button type="button" size="xs" variant="outline" onClick={() => props.store.toggleLinkRevealed()}>
                    <Eye aria-hidden="true" />
                    {t("settings.mobileConnect.link.showCode")}
                  </Button>
                </CodeSlot>
              }
            >
              <LinkCode url={current().url} connectedName={connected()?.name ?? null} onHide={hide} />
            </Show>
          )}
        </Show>
        <Show when={link().error}>
          {(error) => (
            <Text class="settings-modal-error" variant="caption" role="alert">
              {error()}
            </Text>
          )}
        </Show>
      </div>
    </DialogFrame>
  );
}

/** The permanent code with its warning. It counts down from its first render and hides at zero. */
function LinkCode(props: { url: string; connectedName: string | null; onHide: () => void }) {
  const { t } = useText();
  const shownAt = Date.now();
  const [left, setLeft] = createSignal(LINK_VISIBLE_SECONDS);
  const timer = window.setInterval(() => {
    const next = Math.max(0, LINK_VISIBLE_SECONDS - Math.floor((Date.now() - shownAt) / 1_000));
    setLeft(next);
    if (next === 0) props.onHide();
  }, 1_000);
  onCleanup(() => window.clearInterval(timer));
  return (
    <div class="settings-mobile-link-code settings-mobile-enter" aria-live="polite">
      <CodeStage
        value={props.url}
        label={t("settings.mobileConnect.link.qrLabel")}
        connected={Boolean(props.connectedName)}
        tag={
          <Show
            when={props.connectedName}
            fallback={
              <QrTag kind="permanent">
                {t("settings.mobileConnect.qr.permanent")}
                <span class="settings-mobile-qr-tag-time">{countdown(left())}</span>
              </QrTag>
            }
          >
            {(name) => (
              <span role="status">
                <QrTag kind="success">{t("settings.mobileConnect.qr.connected", { name: name() })}</QrTag>
              </span>
            )}
          </Show>
        }
      />
      <span class="settings-mobile-link-warning">
        <ShieldCheck aria-hidden="true" />
        <Text variant="body-sm" class="settings-mobile-link-warning-title">
          {t("settings.mobileConnect.link.private.title")}
        </Text>
      </span>
      <Text variant="caption" tone="muted">
        {t("settings.mobileConnect.link.private.description", { time: countdown(left()) })}
      </Text>
      <div class="settings-mobile-dialog-actions">
        <CopyButton
          variant="outline"
          size="sm"
          value={props.url}
          label={t("settings.mobileConnect.app.copyLink")}
          copiedLabel={t("settings.mobileConnect.app.linkCopied")}
        />
        <Button type="button" size="sm" variant="ghost" onClick={() => props.onHide()}>
          <EyeOff aria-hidden="true" />
          {t("settings.mobileConnect.link.hideCode")}
        </Button>
      </div>
    </div>
  );
}
