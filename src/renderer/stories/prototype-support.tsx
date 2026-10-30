/**
 * What a prototype needs to show a new part in the real app: the app on the preview mock, the
 * elements of its shell, and a way to put the new part into one of them. A prototype hand-builds
 * only the new part, so everything around it looks as the app looks now.
 */

import { type JSX, Portal } from "@solidjs/web";
import { createStore, onSettled, Show, untrack } from "solid-js";
import { App } from "../src/App";
import { createMockOpenBot, type MockOpenBotControls, type MockOpenBotOptions } from "../src/preview/mock-openbot";
import { OpenBotPlayground } from "../src/preview/OpenBotPlayground";

/** The real app on the preview mock. `setup` adds data to the mock before the app reads it. */
export function PrototypeApp(props: { options?: MockOpenBotOptions; setup?: (mock: MockOpenBotControls) => void }) {
  return (
    <OpenBotPlayground
      options={props.options}
      dependencies={{
        createMock: (options) => {
          const mock = createMockOpenBot(options);
          untrack(() => props.setup)?.(mock);
          return mock;
        },
        renderApp: () => <App />,
      }}
    />
  );
}

/** The shell elements that a prototype can put a part into, and their selectors. */
const SLOTS = [
  ["header", ".conversation-header"],
  ["topbar", ".sidebar-topbar"],
  ["rail", "nav.window-rail"],
  ["sidebar", "aside.sidebar"],
] as const;

export type AppSlotName = (typeof SLOTS)[number][0];

/**
 * The shell elements of the app under `attach`. The app draws them after its first data arrives,
 * and a new chat draws a new header, so the store follows each change of the DOM.
 */
export function createAppDom() {
  const [dom, setDom] = createStore<{ root: HTMLElement | null } & Record<AppSlotName, Element | null>>({
    root: null,
    header: null,
    topbar: null,
    rail: null,
    sidebar: null,
  });

  const sync = (root: HTMLElement) =>
    setDom((draft) => {
      for (const [slot, selector] of SLOTS) draft[slot] = root.querySelector(selector);
    });

  onSettled(() => {
    const root = dom.root;
    if (!root) return;
    let frame = 0;
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => sync(root));
    });
    observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
    sync(root);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  });

  return {
    dom,
    /** The `ref` of the element that holds `PrototypeApp`. */
    attach: (root: HTMLElement) =>
      setDom((draft) => {
        draft.root = root;
      }),
  };
}

export type AppDom = ReturnType<typeof createAppDom>;

/** Opens a chat as the user does: a click on its sidebar row. Returns false when no row shows it. */
export function openChat(root: HTMLElement, id: string): boolean {
  const row = root.querySelector<HTMLElement>(`[data-chat-id="${CSS.escape(id)}"] .agent-row`);
  row?.click();
  return row !== null;
}

/** Puts `children` at the end of a shell element. A new element, such as a new chat header, gets them again. */
export function AppSlot(props: { app: AppDom; slot: AppSlotName; children: JSX.Element }) {
  return (
    <Show when={props.app.dom[props.slot]} keyed>
      {(element) => <Portal mount={element}>{props.children}</Portal>}
    </Show>
  );
}
