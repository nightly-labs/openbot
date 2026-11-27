import { type JSX, Portal } from "@solidjs/web";
import { createStore, onSettled, Show, untrack } from "solid-js";
import { App } from "../src/App";
import { skipStartupSplash } from "../src/AppView";
import { createMockOpenBot, type MockOpenBotControls, type MockOpenBotOptions } from "../src/preview/mock-openbot";
import { OpenBotPlayground } from "../src/preview/OpenBotPlayground";

export function PrototypeApp(props: { options?: MockOpenBotOptions; setup?: (mock: MockOpenBotControls) => void }) {
  skipStartupSplash();
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

const SLOTS = [
  ["header", ".conversation-header"],
  ["topbar", ".sidebar-topbar"],
  ["rail", "nav.window-rail"],
  ["sidebar", "aside.sidebar"],
] as const;

export type AppSlotName = (typeof SLOTS)[number][0];

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
    attach: (root: HTMLElement) =>
      setDom((draft) => {
        draft.root = root;
      }),
  };
}

export type AppDom = ReturnType<typeof createAppDom>;

export function openChat(root: HTMLElement, id: string): boolean {
  const row = root.querySelector<HTMLElement>(`[data-chat-id="${CSS.escape(id)}"] .agent-row`);
  row?.click();
  return row !== null;
}

export function AppSlot(props: { app: AppDom; slot: AppSlotName; children: JSX.Element }) {
  return (
    <Show when={props.app.dom[props.slot]} keyed>
      {(element) => <Portal mount={element}>{props.children}</Portal>}
    </Show>
  );
}
