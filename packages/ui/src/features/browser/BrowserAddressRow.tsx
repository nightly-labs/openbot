import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { Button, CircleDot, Clock3, Globe2, Input, Listbox, Search, TriangleAlert, UserRound } from "@openbot/ui";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import {
  BrowserBackIcon,
  BrowserForwardIcon,
  BrowserReloadIcon,
  BrowserStopIcon,
} from "@openbot/ui/features/conversation/ConversationIcons";
import { useText } from "@openbot/ui/text";
import { createMemo, createStore, createUniqueId, flush, Show } from "solid-js";
import { BrowserPageMenu } from "./BrowserPageMenu";
import { BrowserProfileDot } from "./BrowserProfileColor";
import { BrowserOwnerIcon } from "./BrowserTabIcon";
import { browserActionLabel } from "./browser-action-labels";
import { type BrowserFullViewProps, browserTabProfileLabel, browserTabStoppable } from "./browser-full-view-types";
import { useBrowserPageCover } from "./browser-page-cover";
import {
  type BrowserSuggestion,
  browserAddressUrl,
  browserCompletion,
  browserDisplayUrl,
  browserSuggestions,
} from "./browser-suggestions";
import { browserAriaShortcut } from "./browser-view-shortcuts";

function SuggestionIcon(props: { view: BrowserFullViewProps; row: BrowserSuggestion }) {
  const tab = () => props.view.tabs.find((candidate) => candidate.id === props.row.tabId);
  return (
    <span class="browser-full-suggest-icon">
      <Show when={props.row.kind === "tab" && tab()}>
        {(open) => <BrowserOwnerIcon agent={props.view.ownerForTab(open())} />}
      </Show>
      <Show when={props.row.kind === "history"}>
        <Clock3 aria-hidden="true" />
      </Show>
      <Show when={props.row.kind === "search"}>
        <Search aria-hidden="true" />
      </Show>
      <Show when={props.row.kind === "url"}>
        <Globe2 aria-hidden="true" />
      </Show>
    </span>
  );
}

interface AddressState {
  open: boolean;
  /** The text that the user typed. The suggestions follow it. */
  typed: string;
  /** The text in the field while it is edited; undefined shows the page address. */
  text: string | undefined;
  /** The highlighted row, or -1. */
  active: number;
  /** True when the field shows a completed address after the typed text. */
  completed: boolean;
}

const CLOSED_ADDRESS: AddressState = { open: false, typed: "", text: undefined, active: -1, completed: false };

/**
 * Back, forward, reload, and the address with its suggestions: open tabs, history, and search hints.
 * The field completes a visited address as you type. Arrow keys move in the rows; Enter opens one.
 */
export function BrowserAddressRow(props: {
  view: BrowserFullViewProps;
  ref: (input: HTMLInputElement) => void;
  narrow: boolean;
  onNewTab: () => void;
}) {
  const { t } = useText();
  const listId = createUniqueId();
  const [address, setAddress] = createStore<AddressState>({ ...CLOSED_ADDRESS });
  let input: HTMLInputElement | undefined;
  let selectOnPointerUp = false;

  const tab = () => props.view.activeTab;
  const profile = () => {
    const current = tab();
    return current ? props.view.profileForTab?.(current) : undefined;
  };
  const acting = () => {
    const current = tab();
    const session = current ? props.view.controlForTab(current) : undefined;
    const agent = current && session?.phase === "acting" ? props.view.controllerForTab(current) : undefined;
    return agent && session ? { agent, session } : undefined;
  };
  const rows = createMemo(() => {
    if (!address.open) return [];
    const completion = address.completed ? browserCompletion(address.typed, props.view.history) : undefined;
    return browserSuggestions({
      typed: address.typed,
      completion,
      tabs: props.view.tabs,
      activeTabId: tab()?.id,
      history: props.view.history,
    });
  });
  const listOpen = () => address.open && rows().length > 0;
  useBrowserPageCover(listOpen);

  const edit = (element: HTMLInputElement, typed: string, complete: boolean) => {
    const completion = complete ? browserCompletion(typed, props.view.history) : undefined;
    const shown = completion ? typed + browserDisplayUrl(completion.url).slice(typed.length) : typed;
    setAddress((state) => {
      state.open = true;
      state.typed = typed;
      state.text = shown;
      state.active = typed.trim() ? 0 : -1;
      state.completed = completion !== undefined;
    });
    flush();
    if (shown !== typed) element.setSelectionRange(typed.length, shown.length);
  };

  const finish = () => {
    setAddress(() => ({ ...CLOSED_ADDRESS }));
    input?.blur();
  };

  /** The highlighted row is the selected option, so the list marks it for a screen reader. */
  const activeValue = createMemo(() => {
    const row = rows()[address.active];
    return row ? new Set([row.id]) : new Set<string>();
  });
  const choose = (row: BrowserSuggestion) => {
    if (row.tabId) props.view.onActivateTab(row.tabId);
    else props.view.onOpenAddress(row.url, tab()?.id);
    finish();
  };

  const onKeyDown = (event: KeyboardEvent & { currentTarget: HTMLInputElement }) => {
    // These keys choose and commit the text of an input method.
    if (event.isComposing || event.keyCode === 229) return;
    const list = rows();
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!address.open) {
        setAddress((state) => {
          state.open = true;
        });
        return;
      }
      if (list.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      const next =
        address.active < 0 ? (step > 0 ? 0 : list.length - 1) : (address.active + step + list.length) % list.length;
      const row = list[next];
      if (!row) return;
      setAddress((state) => {
        state.active = next;
        state.text = row.text;
      });
    } else if (event.key === "Enter") {
      event.preventDefault();
      const row = list[address.active];
      const value = event.currentTarget.value.trim();
      if (row) choose(row);
      else if (value) {
        props.view.onOpenAddress(browserAddressUrl(value), tab()?.id);
        finish();
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (address.open || address.text !== undefined) {
        setAddress(() => ({ ...CLOSED_ADDRESS }));
        flush();
        event.currentTarget.select();
      } else event.currentTarget.blur();
    }
  };

  return (
    <div class="browser-full-address-row">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t("browser.goBack")}
        aria-keyshortcuts={browserAriaShortcut("back", props.view.shortcuts)}
        disabled={!tab() || tab()?.canGoBack === false}
        data-cuelume-tap="navigate"
        onClick={() => {
          const current = tab();
          if (current) props.view.onNavigate(current.id, "back");
        }}
      >
        <BrowserBackIcon />
      </Button>
      {/* A narrow row keeps Back here; Forward and Reload go in the page menu. */}
      <Show when={!props.narrow}>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("browser.goForward")}
          aria-keyshortcuts={browserAriaShortcut("forward", props.view.shortcuts)}
          disabled={!tab() || tab()?.canGoForward === false}
          data-cuelume-tap="navigate"
          onClick={() => {
            const current = tab();
            if (current) props.view.onNavigate(current.id, "forward");
          }}
        >
          <BrowserForwardIcon />
        </Button>
        <Show
          when={browserTabStoppable(tab())}
          fallback={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("browser.reload")}
              aria-keyshortcuts={browserAriaShortcut("reload", props.view.shortcuts)}
              disabled={!tab()?.url}
              onClick={() => {
                const current = tab();
                if (current) props.view.onReload(current.id);
              }}
            >
              <BrowserReloadIcon />
            </Button>
          }
        >
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("browser.stopLoading")}
            onClick={() => {
              const current = tab();
              if (current) props.view.onStop(current.id);
            }}
          >
            <BrowserStopIcon />
          </Button>
        </Show>
      </Show>
      <form class="browser-full-capsule" onSubmit={(event) => event.preventDefault()}>
        <Show when={acting()}>
          {(control) => (
            <span
              class="browser-full-capsule-agent"
              title={t("browser.tab.controlStatus", {
                name: control().agent.name,
                action: t(browserActionLabel(control().session)),
              })}
            >
              <AgentAvatar agent={control().agent} class="browser-full-owner-avatar" />
            </span>
          )}
        </Show>
        <Input
          ref={(element: HTMLInputElement) => {
            input = element;
            props.ref(element);
          }}
          class="browser-full-capsule-input"
          type="text"
          role="combobox"
          autocomplete="off"
          spellcheck={false}
          maxlength={INPUT_LIMITS.browserUrl}
          aria-label={t("browser.address.label")}
          aria-keyshortcuts={browserAriaShortcut("address", props.view.shortcuts)}
          aria-autocomplete="both"
          aria-expanded={listOpen() ? "true" : "false"}
          aria-controls={listOpen() ? listId : undefined}
          aria-activedescendant={listOpen() && address.active >= 0 ? `${listId}-${address.active}` : undefined}
          placeholder={t("browser.address.placeholder")}
          value={address.text ?? tab()?.url ?? ""}
          onInput={(event: InputEvent & { currentTarget: HTMLInputElement }) =>
            edit(
              event.currentTarget,
              event.currentTarget.value,
              // A completion selects text, which ends the text that an input method composes.
              !event.isComposing && event.inputType.startsWith("insert"),
            )
          }
          onKeyDown={onKeyDown}
          onFocus={(event: FocusEvent & { currentTarget: HTMLInputElement }) => {
            setAddress(() => ({ ...CLOSED_ADDRESS, open: true }));
            flush();
            event.currentTarget.select();
          }}
          // A click that focuses the field selects all of it, as in other browsers; a second click places the caret.
          onPointerDown={(event: PointerEvent & { currentTarget: HTMLInputElement }) => {
            selectOnPointerUp = document.activeElement !== event.currentTarget;
          }}
          onMouseUp={(event: MouseEvent) => {
            if (selectOnPointerUp) event.preventDefault();
            selectOnPointerUp = false;
          }}
          onBlur={() => setAddress(() => ({ ...CLOSED_ADDRESS }))}
        />
        <Show when={listOpen()}>
          <Listbox.Root<BrowserSuggestion>
            as="div"
            id={listId}
            aria-label={t("browser.address.suggestions")}
            class="ui-popover-menu-surface browser-full-suggest"
            options={rows()}
            optionValue={(row) => row.id}
            optionTextValue={(row) => row.title}
            selectionMode="single"
            disallowEmptySelection={true}
            allowDuplicateSelectionEvents={true}
            // The field keeps the focus; the list is a part of the combobox.
            shouldUseVirtualFocus={true}
            shouldSelectOnPressUp={true}
            value={activeValue()}
            onChange={(keys) => {
              const key = keys.values().next().value;
              const row = rows().find((candidate) => candidate.id === key);
              if (row) choose(row);
            }}
            renderItem={(item) => {
              const row = item.rawValue;
              const index = () => rows().findIndex((candidate) => candidate.id === item.key);
              return (
                <Listbox.Item
                  item={item}
                  id={`${listId}-${index()}`}
                  class="browser-full-suggest-row"
                  onPointerDown={(event: PointerEvent) => event.preventDefault()}
                >
                  <SuggestionIcon view={props.view} row={row} />
                  <span class="browser-full-suggest-title">{row.title}</span>
                  <span class="browser-full-suggest-detail">
                    {row.detail ?? (row.kind === "url" ? "" : t("browser.address.search"))}
                  </span>
                  <Show when={row.kind === "tab"}>
                    <span class="browser-full-suggest-switch">{t("browser.address.switchToTab")}</span>
                  </Show>
                </Listbox.Item>
              );
            }}
          />
        </Show>
      </form>
      <Show when={profile()}>
        {(current) => (
          <span class="browser-profile-status" title={browserTabProfileLabel(t, current())}>
            <Show when={current().hue} fallback={<UserRound aria-hidden="true" />}>
              {(hue) => <BrowserProfileDot hue={hue()} />}
            </Show>
            <span class="browser-profile-status-name">{current().name ?? browserTabProfileLabel(t, current())}</span>
          </span>
        )}
      </Show>
      <Show when={tab()?.recording}>
        <span class="browser-recording-status" role="status" aria-label={t("browser.recording.label")}>
          <CircleDot /> {t("browser.recording.badge")}
        </span>
      </Show>
      <Show when={tab()?.diagnosticErrorCount}>
        {(errorCount) => (
          <span
            class="browser-diagnostic-status"
            role="status"
            title={t("browser.diagnosticErrors", { count: errorCount() })}
            aria-label={t("browser.diagnosticErrors", { count: errorCount() })}
          >
            <TriangleAlert /> {errorCount()}
          </span>
        )}
      </Show>
      <BrowserPageMenu view={props.view} narrow={props.narrow} onNewTab={props.onNewTab} />
    </div>
  );
}
