import type { BrowserTab } from "@openbot/contracts/ipc";
import { Globe2, LoaderCircle } from "@openbot/ui";
import type { AgentProfile } from "@openbot/ui/data";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import { useText } from "@openbot/ui/text";
import { Show } from "solid-js";
import type { BrowserFullViewProps } from "./browser-full-view-types";
import { browserDisplayUrl } from "./browser-suggestions";
import { type BrowserShortcutName, browserShortcutGlyph } from "./browser-view-shortcuts";

/** The agent of a tab, or a globe for a tab of the user. A ring shows that the agent acts on the page now. */
export function BrowserOwnerIcon(props: { agent: AgentProfile | undefined; acting?: boolean }) {
  return (
    <Show when={props.agent} fallback={<Globe2 class="browser-full-owner-globe" aria-hidden="true" />}>
      {(agent) => (
        <AgentAvatar
          agent={agent()}
          class={props.acting ? "browser-full-owner-avatar browser-full-owner-acting" : "browser-full-owner-avatar"}
        />
      )}
    </Show>
  );
}

export function BrowserTabIcon(props: { view: BrowserFullViewProps; tab: BrowserTab }) {
  return (
    <Show when={!props.tab.loading} fallback={<LoaderCircle class="browser-full-spin" aria-hidden="true" />}>
      <BrowserOwnerIcon
        agent={props.view.ownerForTab(props.tab)}
        acting={props.view.controlForTab(props.tab)?.phase === "acting"}
      />
    </Show>
  );
}

/** The keys of a menu row. The web client has none. */
export function BrowserShortcutHint(props: { view: BrowserFullViewProps; name: BrowserShortcutName }) {
  return (
    <Show when={props.view.shortcuts}>
      {(platform) => (
        <span class="ui-menu-trailing" aria-hidden="true">
          {browserShortcutGlyph(props.name, platform())}
        </span>
      )}
    </Show>
  );
}

/** The name of a tab: its title, its address, or the loading text. */
export function useBrowserTabTitle() {
  const { t } = useText();
  return (tab: BrowserTab) =>
    tab.loading && !tab.title ? t("common.loading") : tab.title || browserDisplayUrl(tab.url) || t("browser.newTab");
}
