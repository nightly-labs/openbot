import { Badge, Check, DropdownMenu, Folder, Inbox, SlidersHorizontal, SlidingTabs } from "@openbot/ui";
import { createEffect, createSignal, For, type ParentProps, Show } from "solid-js";
import { useText } from "../../text";
import { SIDEBAR_NO_LIST_FILTER, sidebarFolderTreeIds } from "./sidebar-list-filter";
import { useSidebarScope } from "./sidebar-scope";
import { SIDEBAR_ALL_TAB_ID, SIDEBAR_UNREAD_TAB_ID, type SidebarTab, sidebarFolderTabId } from "./sidebar-tabs";

const TAB_SCROLL_MARGIN = 16;

function revealSelectedTab(scroller: HTMLElement) {
  const selected = scroller.querySelector<HTMLElement>('[aria-selected="true"]');
  if (!selected) return;
  const start = selected.offsetLeft - TAB_SCROLL_MARGIN;
  const end = selected.offsetLeft + selected.offsetWidth + TAB_SCROLL_MARGIN - scroller.clientWidth;
  if (scroller.scrollLeft > start) scroller.scrollTo({ left: start, behavior: "smooth" });
  else if (scroller.scrollLeft < end) scroller.scrollTo({ left: end, behavior: "smooth" });
}

function scrollTabsWithWheel(event: WheelEvent) {
  const scroller = event.currentTarget;
  if (!(scroller instanceof HTMLElement) || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
  if (scroller.scrollWidth <= scroller.clientWidth) return;
  event.preventDefault();
  scroller.scrollLeft += event.deltaY;
}

function MenuMark(props: { on: boolean }) {
  return (
    <span class="ui-menu-check" data-checked={props.on ? "" : undefined} aria-hidden="true">
      <Show when={props.on}>
        <Check />
      </Show>
    </span>
  );
}

function SidebarEditTabsMenu() {
  const { filterFolders, listFilterCount, props, sidebarTabs } = useSidebarScope();
  const { t } = useText();
  const chosen = (id: string) => sidebarTabs.chosenTabIds().includes(id);
  return (
    <DropdownMenu.Root placement="bottom-end" gutter={4}>
      <DropdownMenu.Trigger
        class="sidebar-icon-button sidebar-tabs-edit no-drag"
        aria-label={t("sidebar.tabs.edit")}
        aria-hidden={props.compact ? "true" : undefined}
        tabindex={props.compact ? -1 : 0}
      >
        <SlidersHorizontal aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="sidebar-filter-menu-content" aria-label={t("sidebar.tabs.edit")}>
          <DropdownMenu.CheckboxItem
            checked={chosen(SIDEBAR_UNREAD_TAB_ID)}
            closeOnSelect={false}
            onChange={() => sidebarTabs.toggleTab(SIDEBAR_UNREAD_TAB_ID)}
          >
            <MenuMark on={chosen(SIDEBAR_UNREAD_TAB_ID)} />
            <Inbox class="agent-context-icon size-4" aria-hidden="true" />
            <span>{t("sidebar.filter.unread")}</span>
          </DropdownMenu.CheckboxItem>
          <Show when={filterFolders().length > 0}>
            <DropdownMenu.Separator />
            <For each={filterFolders()}>
              {(folder) => (
                <DropdownMenu.CheckboxItem
                  checked={chosen(sidebarFolderTabId(folder.id))}
                  closeOnSelect={false}
                  onChange={() => sidebarTabs.toggleTab(sidebarFolderTabId(folder.id))}
                >
                  <MenuMark on={chosen(sidebarFolderTabId(folder.id))} />
                  <Folder class="agent-context-icon size-4" aria-hidden="true" />
                  <span>{folder.name ?? t("sidebar.section.unassigned")}</span>
                  <span class="ui-menu-trailing">
                    {listFilterCount({ ...SIDEBAR_NO_LIST_FILTER, folders: sidebarFolderTreeIds(folder) })}
                  </span>
                </DropdownMenu.CheckboxItem>
              )}
            </For>
          </Show>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function SidebarTabTrigger(props: { tab: SidebarTab }) {
  const { sidebarTabs, props: sidebar } = useSidebarScope();
  const { t } = useText();
  const unread = () => sidebarTabs.tabUnreadCount(props.tab);
  const name = () => {
    if (props.tab.id === SIDEBAR_ALL_TAB_ID) return t("sidebar.tabs.all");
    if (props.tab.id === SIDEBAR_UNREAD_TAB_ID) return t("sidebar.filter.unread");
    return props.tab.folder?.name ?? t("sidebar.section.unassigned");
  };
  return (
    <SlidingTabs.Trigger value={props.tab.id} class="sidebar-tab" tabindex={sidebar.compact ? -1 : undefined}>
      <span class="sidebar-tab-name">{name()}</span>
      <Show when={unread() > 0}>
        <Badge variant="secondary" class="sidebar-tab-count" aria-hidden="true">
          {unread()}
        </Badge>
        <span class="sr-only">{t("sidebar.folder.unread", { count: unread() })}</span>
      </Show>
    </SlidingTabs.Trigger>
  );
}

function SidebarTabStrip() {
  const { props, sidebarTabs } = useSidebarScope();
  const { t } = useText();
  const [scroller, setScroller] = createSignal<HTMLDivElement>();
  const [hiddenStart, setHiddenStart] = createSignal(false);
  const [hiddenEnd, setHiddenEnd] = createSignal(false);
  const measureEdges = () => {
    const element = scroller();
    if (!element) return;
    const overflow = element.scrollWidth - element.clientWidth;
    setHiddenStart(element.scrollLeft > 1);
    setHiddenEnd(element.scrollLeft < overflow - 1);
  };
  createEffect(scroller, (element) => {
    if (!element) return;
    const observer = new ResizeObserver(measureEdges);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    return () => {
      observer.disconnect();
    };
  });
  createEffect(
    () => [scroller(), sidebarTabs.activeTab()?.id, sidebarTabs.tabs().length] as const,
    ([element]) => {
      if (!element) return;
      const frame = requestAnimationFrame(() => {
        revealSelectedTab(element);
      });
      return () => {
        cancelAnimationFrame(frame);
      };
    },
  );
  return (
    <div class="sidebar-tabs" aria-hidden={props.compact ? "true" : undefined}>
      <div
        ref={setScroller}
        class={[
          "sidebar-tabs-scroll",
          { "sidebar-tabs-hidden-start": hiddenStart() },
          { "sidebar-tabs-hidden-end": hiddenEnd() },
        ]}
        onScroll={measureEdges}
        onWheel={scrollTabsWithWheel}
      >
        <SlidingTabs.List class="sidebar-tabs-list" aria-label={t("sidebar.tabs.label")}>
          <For each={sidebarTabs.tabs()}>{(tab) => <SidebarTabTrigger tab={tab} />}</For>
        </SlidingTabs.List>
      </div>
      <SidebarEditTabsMenu />
    </div>
  );
}

export function SidebarTabs(props: ParentProps) {
  const { sidebarTabs } = useSidebarScope();
  return (
    <Show when={sidebarTabs.activeTab()} fallback={props.children}>
      {(active) => (
        <SlidingTabs.Root class="sidebar-tabs-root" value={active().id} onChange={sidebarTabs.selectTab}>
          <SidebarTabStrip />
          <SlidingTabs.Content value={active().id} class="sidebar-tab-panel">
            {props.children}
          </SlidingTabs.Content>
        </SlidingTabs.Root>
      )}
    </Show>
  );
}
