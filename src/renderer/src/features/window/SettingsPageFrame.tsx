import type { ServerSummary } from "@openbot/contracts/ipc";
import { ArrowLeft, IconButton } from "@openbot/ui";
import { ServerMark } from "@openbot/ui/features/servers/ServerRail";
import type { SettingsPagePlacement } from "@openbot/ui/features/settings/SettingsDialogShell";
import { useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { onSettled } from "solid-js";
import { listenForPageEscape } from "./page-escape";

/**
 * The frame of a settings page, on desktop and on the web: the heading and the section list at the
 * width of the sidebar, and the panel. The settings panel shows its nav and content in the mounts
 * that `onMounts` gets.
 */
export function SettingsPageFrame(props: {
  heading: JSX.Element;
  /** Content between the heading and the section list, such as a search. */
  children?: JSX.Element;
  sectionsHidden?: boolean;
  onMounts: (mounts: SettingsPagePlacement | undefined) => void;
  /** Escape outside a popup or a text field of the window. */
  onEscape: () => void;
  /** The Back button before the heading, as on the usage and schedule pages. */
  onClose: () => void;
}) {
  const { t } = useText();
  let nav!: HTMLDivElement;
  let content!: HTMLDivElement;
  let root!: HTMLDivElement;

  onSettled(() => {
    props.onMounts({ nav, content });
    // As on the usage and schedule pages, the heading takes the focus, so a screen reader reads the
    // page that opened. The settings shell puts the focus back on the opener when the page closes.
    root.querySelector<HTMLElement>(".settings-page-title")?.focus({ preventScroll: true });
    const stopListening = listenForPageEscape(root, () => props.onEscape());
    return () => {
      stopListening();
      props.onMounts(undefined);
    };
  });

  return (
    <div class="settings-page" ref={root}>
      <div class="settings-page-nav">
        <div class="settings-page-heading">
          <IconButton variant="ghost" label={t("common.back")} onClick={() => props.onClose()}>
            <ArrowLeft />
          </IconButton>
          {props.heading}
        </div>
        {props.children}
        <div class="settings-page-sections" ref={nav} hidden={props.sectionsHidden} />
      </div>
      <div class="settings-page-content" ref={content} />
    </div>
  );
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
