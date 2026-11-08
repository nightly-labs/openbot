import type { CentralAuthUser, ServerSummary } from "@openbot/contracts/ipc";
import { Button, ChevronRight, Input, Search, UserAvatar, UserRound } from "@openbot/ui";
import { ServerMark } from "@openbot/ui/features/servers/ServerRail";
import type { SettingsPagePlacement } from "@openbot/ui/features/settings/SettingsDialogShell";
import { useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { flush, onSettled, Show } from "solid-js";

/**
 * The frame of a settings page, on desktop and on the web: the heading and the section list at the
 * width of the sidebar, the path to an open detail page in the top row, and the panel. The settings
 * panel shows its nav, path and content in the mounts that `onMounts` gets. The footer, below the
 * section list, holds the row that opens the other settings page.
 */
export function SettingsPageFrame(props: {
  heading: JSX.Element;
  /** Content between the heading and the section list, such as a search. */
  children?: JSX.Element;
  sectionsHidden?: boolean;
  footer?: JSX.Element;
  onMounts: (mounts: SettingsPagePlacement | undefined) => void;
  /** Escape outside a popup or a text field of the window. */
  onEscape: () => void;
}) {
  let nav!: HTMLDivElement;
  let content!: HTMLDivElement;
  let path!: HTMLDivElement;
  let root!: HTMLDivElement;

  onSettled(() => {
    props.onMounts({ nav, content, path });
    // As on the usage and schedule pages, the heading takes the focus, so a screen reader reads the
    // page that opened. The settings shell puts the focus back on the opener when the page closes.
    root.querySelector<HTMLElement>(".settings-page-title")?.focus({ preventScroll: true });
    // Escape closes the page, as it closed the settings dialog. On the document and after the
    // delegated handlers, so a control that handles Escape keeps it. A click can put the focus back on
    // the rail or the server menu, so a target outside the page also counts, except an open popup or a
    // text field.
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
      <div class="settings-page-content" ref={content} />
    </div>
  );
}

/** The search field above the section list of a settings page. Enter with a query calls `onEnter`. */
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

/**
 * Asks the server settings to open the first section that the search finds, then moves the focus to that
 * section. The server settings clear the search when they open a section; with no match, nothing changes.
 */
export function openFirstSettingsSection(nav: HTMLElement | undefined, request: () => void, query: () => string) {
  request();
  // The section opens, and the tabs move their focus key to it, before the focus moves.
  flush();
  if (query()) return;
  nav?.querySelector<HTMLElement>(".settings-modal-nav-item[data-selected]")?.focus();
}

/** The heading of a server settings page: the server mark and name, as the server menu shows them. */
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

/**
 * The row of the user settings page that opens the settings of the server in the top row. It names the
 * server, so the user sees that this page is not its settings.
 */
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

/**
 * The row of a server settings page that opens the user settings. It shows the account photo; without a
 * photo, it shows a person icon, as initials are not legible at the size of an icon.
 */
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
