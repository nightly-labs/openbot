import type { CentralAuthUser, ServerSummary } from "@openbot/contracts/ipc";
import { Button, ChevronRight, Input, Search, UserAvatar, UserRound, X } from "@openbot/ui";
import { ServerMark } from "@openbot/ui/features/servers/ServerRail";
import type { SettingsPagePlacement } from "@openbot/ui/features/settings/SettingsDialogShell";
import { useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { flush, onSettled, Show } from "solid-js";

export function SettingsPageFrame(props: {
  heading: JSX.Element;
  children?: JSX.Element;
  sectionsHidden?: boolean;
  footer?: JSX.Element;
  onMounts: (mounts: SettingsPagePlacement | undefined) => void;
  onEscape: () => void;
  onClose: () => void;
}) {
  const { t } = useText();
  let nav!: HTMLDivElement;
  let content!: HTMLDivElement;
  let path!: HTMLDivElement;
  let root!: HTMLDivElement;

  onSettled(() => {
    props.onMounts({ nav, content, path });
    if (!content.contains(document.activeElement)) {
      root.querySelector<HTMLElement>(".settings-page-title")?.focus({ preventScroll: true });
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("[role=dialog], [role=alertdialog], [role=menu], [role=listbox]")) return;
      if (target && !root.contains(target) && target.closest("input, textarea, select, [contenteditable]")) return;
      event.preventDefault();
      props.onEscape();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      props.onMounts(undefined);
    };
  });

  return (
    <div class="settings-page" ref={root}>
      <div class="settings-page-nav">
        {props.heading}
        {props.children}
        <div class="settings-page-sections" ref={nav} hidden={props.sectionsHidden} />
        <div class="settings-page-footer">{props.footer}</div>
      </div>
      <div class="settings-page-path-row" ref={path} />
      <Button
        variant="ghost"
        size="icon-sm"
        class="settings-page-close"
        aria-label={t("common.close")}
        data-cuelume-tap="close"
        onClick={() => props.onClose()}
      >
        <X aria-hidden="true" />
      </Button>
      <div class="settings-page-content" ref={content} />
    </div>
  );
}

export function SettingsSearchField(props: { value: string; onInput: (value: string) => void; onEnter: () => void }) {
  const { t } = useText();
  return (
    <label class="search-field settings-page-search">
      <Search aria-hidden="true" />
      <Input
        type="search"
        aria-label={t("app.settingsPage.search")}
        placeholder={t("app.settingsPage.searchPlaceholder")}
        spellcheck={false}
        value={props.value}
        onInput={(event) => props.onInput(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || !props.value.trim()) return;
          event.preventDefault();
          props.onEnter();
        }}
      />
    </label>
  );
}

export function openFirstSettingsSection(nav: HTMLElement | undefined, request: () => void, query: () => string) {
  request();
  flush();
  if (query()) return;
  nav?.querySelector<HTMLElement>(".settings-modal-nav-item[data-selected]")?.focus();
}

export function ServerSettingsPageTitle(props: { server: ServerSummary }) {
  return (
    <h1 class="settings-page-title settings-page-server" tabindex={-1}>
      <span class="server-menu-mark" aria-hidden="true">
        <ServerMark server={props.server} />
      </span>
      <span class="server-menu-name">{props.server.name}</span>
    </h1>
  );
}

export function ServerSettingsLink(props: { server: ServerSummary; onOpen: () => void }) {
  const { t } = useText();
  return (
    <Button
      variant="ghost"
      type="button"
      class="settings-modal-nav-item settings-page-switch"
      onClick={() => props.onOpen()}
    >
      <span class="server-menu-mark" aria-hidden="true">
        <ServerMark server={props.server} />
      </span>
      <span class="settings-page-switch-label">
        {t("app.settingsPage.serverSettings", { server: props.server.name })}
      </span>
      <ChevronRight class="settings-page-switch-chevron" aria-hidden="true" />
    </Button>
  );
}

export function PersonalSettingsLink(props: {
  account: Pick<CentralAuthUser, "name" | "email" | "avatarUrl"> | null;
  onOpen: () => void;
}) {
  const { t } = useText();
  return (
    <Button
      variant="ghost"
      type="button"
      class="settings-modal-nav-item settings-page-switch"
      onClick={() => props.onOpen()}
    >
      <Show when={props.account?.avatarUrl ? props.account : null} fallback={<UserRound aria-hidden="true" />}>
        {(account) => <UserAvatar user={account()} class="settings-page-switch-avatar" decorative />}
      </Show>
      <span class="settings-page-switch-label">{t("app.settingsPage.title")}</span>
      <ChevronRight class="settings-page-switch-chevron" aria-hidden="true" />
    </Button>
  );
}
