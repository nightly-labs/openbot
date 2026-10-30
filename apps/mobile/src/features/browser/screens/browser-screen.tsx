import type { BrowserViewContextMenu, BrowserViewInput } from "@openbot/contracts/team-protocol/browser-view-v1";
import * as Clipboard from "expo-clipboard";
import { GlassView } from "expo-glass-effect";
import { router, useLocalSearchParams } from "expo-router";
import { Button, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import ArrowLeft from "lucide-react-native/icons/arrow-left";
import ChevronLeft from "lucide-react-native/icons/chevron-left";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import ChevronsUpDown from "lucide-react-native/icons/chevrons-up-down";
import CircleQuestionMark from "lucide-react-native/icons/circle-question-mark";
import ClipboardList from "lucide-react-native/icons/clipboard-list";
import Ellipsis from "lucide-react-native/icons/ellipsis";
import Keyboard from "lucide-react-native/icons/keyboard";
import Plus from "lucide-react-native/icons/plus";
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  ActionSheetIOS,
  TextInput,
  type TextInputInstance,
  type TextInputKeyPressEvent,
  View,
  type ViewStyle,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import Animated, { type CSSTransitionProperties, cubicBezier, FadeIn, FadeOut } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useUniwind } from "uniwind";
import { BloubAvatar } from "@/features/agents/components/bloub-avatar";
import { ChatGlassButton, ChatGlassIconButton } from "@/features/chat/components/chat-glass-icon-button";
import {
  useAgentBrowserTab,
  useAgentBrowserTabs,
  useBrowserRequests,
  useBrowserTabsLoaded,
} from "@/features/workspace/components/use-live-workspace";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import type { MobileAgent, MobileBrowserViewSupport } from "@/features/workspace/model/workspace-types";
import { type MenuAction, type MenuComponentRef, MenuView } from "@/shared/components/menu-view";
import { haptics } from "@/shared/lib/haptics";
import { useReducedMotion } from "@/shared/lib/motion";
import { isIOS } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";
import { useAppForeground } from "@/shared/lib/use-app-foreground";
import { useLiquidGlass } from "@/shared/lib/use-liquid-glass";
import { BrowserLiveStage, type BrowserLiveStageHandle } from "../components/browser-live-stage";
import { useBrowserFeature } from "../components/use-browser-feature";
import { useBrowserLiveView } from "../components/use-browser-live-view";
import { useUnseenBrowserTabs } from "../components/use-unseen-browser-tabs";
import { namedKeyInputs, pasteInput, selectAllInputs, textChangeInputs, typedTextInputs } from "../model/browser-keys";
import { useProvideBrowserSheetControls } from "../model/browser-sheet-bridge";
import type { LiveViewMode } from "../model/live-view-gestures";

/** The floating controls are 48 points, 8 points from the safe area, as in the chat. */
const CONTROL_SIZE = 48;
const CONTROL_OFFSET = 8;
/** A paste on a host without the clipboard capability goes as keystrokes, so it is kept short. */
const TYPED_PASTE_MAX_LENGTH = 2_000;
/** The hidden field is emptied past this length, so its text never grows with a long session. */
const KEYBOARD_FIELD_MAX_LENGTH = 256;
const NOTICE_MS = 2_200;
/** A new tab opens this page, as on the desktop. */
const NEW_TAB_URL = "https://www.google.com";
/** The fade of a control that hides in place, as in `ChatGlassButton`. */
const FADE: CSSTransitionProperties = {
  transitionProperty: "opacity",
  transitionDuration: 200,
  transitionTimingFunction: cubicBezier(0.23, 1, 0.32, 1),
};
const NO_SUPPORT: MobileBrowserViewSupport = {
  view: false,
  clipboard: false,
  contextMenu: false,
  viewport: false,
  navigation: false,
};

// Trackpad mode is the default. The mode lasts for the app session: a user who turned it off keeps
// it off on the next tab.
let rememberedMode: LiveViewMode = "trackpad";

/**
 * An agent's browser tabs on the host, live, as a browser the user can use with touch: the
 * pointer follows the page's cursor, and the keyboard and the clipboard reach the page.
 */
export function BrowserScreen() {
  const { agentId, serverId, tabId, agentIds } = useLocalSearchParams<{
    agentId: string;
    serverId?: string;
    tabId?: string;
    /** From a channel: the members, joined by commas, whose browser the person can switch to. */
    agentIds?: string;
  }>();
  const { agents } = useMobileWorkspace();
  const [selectedId, setSelectedId] = useState(agentId);
  const onServer = (id: string) =>
    agents.find((candidate) => candidate.id === id && (!serverId || candidate.serverId === serverId));
  const agent = onServer(selectedId) ?? null;
  const choices = (agentIds?.split(",") ?? []).flatMap((id) => onServer(id) ?? []);
  // Reconnect mounts the view again, with a new session, the same pointer mode and the same tab.
  const [attempt, setAttempt] = useState(0);
  const [chosenTabId, setChosenTabId] = useState(tabId);
  return (
    <>
      {agent ? (
        <BrowserView
          // Another agent has its own tabs and its own live view.
          key={`${agent.id}:${attempt}`}
          agent={agent}
          choices={choices.length > 1 ? choices : []}
          onChooseAgent={(id) => {
            setSelectedId(id);
            setChosenTabId(undefined);
          }}
          preferredTabId={chosenTabId}
          onChooseTab={setChosenTabId}
          onReconnect={() => setAttempt((value) => value + 1)}
        />
      ) : (
        <View className="flex-1 bg-background" />
      )}
    </>
  );
}

function BrowserView({
  agent,
  choices,
  onChooseAgent,
  preferredTabId,
  onChooseTab,
  onReconnect,
}: {
  agent: MobileAgent;
  /** The agents of a channel whose browser the person can switch to. Empty for one agent. */
  choices: readonly MobileAgent[];
  onChooseAgent: (agentId: string) => void;
  /** The tab to show when it is the agent's, such as the tab of a takeover or the tab the user chose. */
  preferredTabId?: string;
  onChooseTab: (tabId: string | undefined) => void;
  onReconnect: () => void;
}) {
  const { t, sourceText, format, errorMessage } = useText();
  const insets = useSafeAreaInsets();
  const liquidGlass = useLiquidGlass();
  const reducedMotion = useReducedMotion();
  const [foreground, fieldBackground] = useThemeColor(["foreground", "default"]);
  const { theme } = useUniwind();
  const appearance = theme === "dark" ? "dark" : "light";
  const iconColor = String(foreground);
  const { servers, browserViewSupport, respondToBrowserTakeover, controlBrowserTab, conversationStore } =
    useMobileWorkspace();
  const server = servers.find((candidate) => candidate.id === agent.serverId);
  const online = server?.state === "online";
  const support = online ? browserViewSupport(agent.serverId) : NO_SUPPORT;
  const allowed = useBrowserFeature();
  // The agent's thread, from its chat. A tab with no agent owner belongs to the agent by its thread.
  const threadId = conversationStore.get(agent.id)?.threadId ?? null;
  const tabs = useAgentBrowserTabs(agent.serverId, agent.id, threadId);
  const tab = useAgentBrowserTab(agent.serverId, agent.id, preferredTabId, threadId);
  // The view stays open under the help sheet, and closes while the app is in the background.
  const appForeground = useAppForeground();
  // The menu needs the clipboard and the input, which need the view: it is read when a menu comes.
  const contextMenu = useRef<(menu: BrowserViewContextMenu) => void>(() => undefined);
  const live = useBrowserLiveView(
    agent.serverId,
    tab?.id ?? null,
    allowed && online && support.view && appForeground,
    (menu) => contextMenu.current(menu),
  );
  const [mode, setMode] = useState<LiveViewMode>(rememberedMode);
  const stage = useRef<BrowserLiveStageHandle>(null);
  const keyboardField = useRef<TextInputInstance>(null);
  const typed = useRef("");
  const [keyboardShown, setKeyboardShown] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [openingTab, setOpeningTab] = useState(false);
  // A tab that opened behind this one, such as from a link, puts a dot on the tab button.
  const tabsLoaded = useBrowserTabsLoaded(agent.serverId);
  const unseenTabs = useUnseenBrowserTabs(tabs, tab?.id ?? null, tabsLoaded, openingTab);
  // Android shows the page's menu as a dropdown that opens from code, at the pointer.
  const [pageMenu, setPageMenu] = useState<{
    actions: MenuAction[];
    run: Map<string, () => void>;
    at: { x: number; y: number };
  } | null>(null);
  const pageMenuView = useRef<MenuComponentRef>(null);
  const takeover = useBrowserRequests(agent.serverId).find(
    (request) => request.agentId === agent.id && (!request.secret || request.secret.requiresReload),
  );

  // The connection came back: a view that ended with it opens again.
  const wasOnline = useRef(online);
  useEffect(() => {
    const reconnected = online && !wasOnline.current;
    wasOnline.current = online;
    if (reconnected && (live.status.kind === "ended" || live.status.kind === "offline")) onReconnect();
  }, [online, live.status.kind, onReconnect]);

  // The phone keyboard types on a tab. When the last tab closes, it closes too.
  useEffect(() => {
    if (!tab) keyboardField.current?.blur();
  }, [tab]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  const ready = live.status.kind === "live";
  const sendKeys = (inputs: readonly BrowserViewInput[]) => {
    for (const input of inputs) live.send(input);
  };

  const paste = async () => {
    let text = "";
    try {
      text = await Clipboard.getStringAsync();
    } catch {
      void haptics.notification("error");
      setNotice(t("mobile.browser.notice.pasteFailed"));
      return;
    }
    if (!text) {
      setNotice(t("mobile.browser.notice.clipboardEmpty"));
      return;
    }
    sendKeys(support.clipboard ? [pasteInput(text)] : typedTextInputs(text.slice(0, TYPED_PASTE_MAX_LENGTH)));
    void haptics.notification("success");
  };

  const fail = (text: string) => {
    void haptics.notification("error");
    setNotice(text);
  };

  const copyText = async (text: string) => {
    try {
      await Clipboard.setStringAsync(text);
      void haptics.notification("success");
      setNotice(t("mobile.browser.notice.copied"));
    } catch {
      fail(t("mobile.browser.notice.copyFailed"));
    }
  };

  /** Copies the page's selection to the phone. The text copied, or null when nothing was. */
  const copy = async () => {
    try {
      const text = await live.requestSelection();
      if (text === null) {
        fail(t("mobile.browser.notice.copyTooLarge"));
        return null;
      }
      if (!text) {
        setNotice(t("mobile.browser.notice.nothingSelected"));
        return null;
      }
      await Clipboard.setStringAsync(text);
      void haptics.notification("success");
      setNotice(t("mobile.browser.notice.copied"));
      return text;
    } catch {
      fail(t("mobile.browser.notice.copyFailed"));
      return null;
    }
  };

  const navigate = (direction: "back" | "forward") => {
    if (!tab) return;
    void haptics.impact("soft");
    void controlBrowserTab(agent.serverId, { type: "navigate", tabId: tab.id, direction }).catch(() =>
      fail(t("mobile.browser.notice.navigateFailed")),
    );
  };

  const reload = () => {
    if (!tab) return;
    void haptics.impact("soft");
    void controlBrowserTab(agent.serverId, { type: "reload", tabId: tab.id }).catch(() =>
      fail(t("mobile.browser.notice.navigateFailed")),
    );
  };

  /** Loads an address in the tab on screen. A host that cannot do that opens it in a new tab. */
  const loadUrl = (url: string) => {
    if (!tab || !support.navigation) {
      void openTab(url);
      return;
    }
    void haptics.impact("soft");
    void controlBrowserTab(agent.serverId, { type: "load", tabId: tab.id, url }).catch(() =>
      fail(t("mobile.browser.notice.navigateFailed")),
    );
  };

  /** A new tab of this agent, in the agent's thread so that the agent can use it too. */
  const openTab = async (url: string) => {
    const ownerThreadId = threadId ?? tabs.find((candidate) => candidate.ownerThreadId)?.ownerThreadId;
    setOpeningTab(true);
    try {
      const opened = await controlBrowserTab(agent.serverId, {
        type: "open",
        url,
        ownerAgentId: agent.id,
        ownerThreadId: ownerThreadId ?? null,
      });
      if (opened) onChooseTab(opened.id);
    } catch (error) {
      // The host's reason, such as its tab limit, says what the user can change.
      fail(errorMessage(error, t("mobile.browser.notice.openTabFailed")));
    } finally {
      setOpeningTab(false);
    }
  };

  /** Closes one of the agent's tabs. When it is the tab on screen, the next one of the agent's tabs shows. */
  const closeTab = async (closedId: string) => {
    const index = tabs.findIndex((candidate) => candidate.id === closedId);
    const next = tabs[index + 1] ?? tabs[index - 1];
    try {
      await controlBrowserTab(agent.serverId, { type: "close", tabId: closedId });
      if (closedId === tab?.id) onChooseTab(next?.id);
    } catch {
      fail(t("mobile.browser.notice.closeTabFailed"));
    }
  };

  // The host's menu of a right-click, as the phone's own action sheet. A right-click on nothing in
  // particular offers the page's actions, as a desktop browser does.
  contextMenu.current = (menu) => {
    const choices: { title: string; run: () => void }[] = [];
    const { link, image } = menu;
    if (link) choices.push({ title: t("mobile.browser.menu.openLink"), run: () => void openTab(link) });
    for (const item of menu.items) {
      if (item === "copy-link" && link)
        choices.push({ title: t("mobile.browser.menu.copyLink"), run: () => void copyText(link) });
      else if (item === "copy-image-address" && image)
        choices.push({ title: t("mobile.browser.menu.copyImageAddress"), run: () => void copyText(image) });
      else if (item === "cut")
        choices.push({
          title: t("mobile.browser.menu.cut"),
          // The host deletes the selection only while it is still the text the phone has.
          run: () => void copy().then((text) => text && live.send({ type: "cut", text })),
        });
      else if (item === "copy") choices.push({ title: t("mobile.browser.menu.copy"), run: () => void copy() });
      else if (item === "paste") choices.push({ title: t("mobile.browser.menu.paste"), run: () => void paste() });
      else if (item === "select-all")
        choices.push({ title: t("mobile.browser.menu.selectAll"), run: () => sendKeys(selectAllInputs()) });
    }
    if (choices.length === 0) {
      choices.push(
        { title: t("mobile.browser.previousPage"), run: () => navigate("back") },
        { title: t("mobile.browser.nextPage"), run: () => navigate("forward") },
        { title: t("mobile.browser.reload"), run: reload },
      );
    }
    if (isIOS) {
      // A SwiftUI menu of `@expo/ui` opens only from a touch on its own button, and this menu opens
      // when the host answers a right-click. The system action sheet opens from code.
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: [...choices.map((choice) => choice.title), t("common.cancel")],
          cancelButtonIndex: choices.length,
          userInterfaceStyle: appearance,
        },
        (index) => choices[index]?.run(),
      );
      return;
    }
    // The Android menu of `@expo/ui` opens from code, under its trigger: a point at the pointer.
    const actions: MenuAction[] = [];
    const run = new Map<string, () => void>();
    for (const [index, choice] of choices.entries()) {
      const id = `page-menu-${index}`;
      actions.push({ id, title: choice.title });
      run.set(id, choice.run);
    }
    setPageMenu({ actions, run, at: stage.current?.pointerPosition() ?? { x: 0, y: 0 } });
  };

  useEffect(() => {
    if (pageMenu) pageMenuView.current?.show();
  }, [pageMenu]);

  const handBack = async () => {
    if (!takeover) return;
    try {
      await respondToBrowserTakeover(agent.serverId, { requestId: takeover.requestId, decision: "complete" });
      void haptics.notification("success");
      if (router.canGoBack()) router.back();
    } catch {
      void haptics.notification("error");
      setNotice(t("mobile.browser.notice.handBackFailed"));
    }
  };

  const toggleKeyboard = () => {
    void haptics.impact("soft");
    if (keyboardShown) keyboardField.current?.blur();
    else keyboardField.current?.focus();
  };

  const options: MenuAction[] = [
    {
      id: "trackpad",
      title: t("mobile.browser.trackpadMode"),
      image: "cursorarrow.motionlines",
      state: mode === "trackpad" ? "on" : "off",
    },
    { id: "recenter", title: t("mobile.browser.recenterPointer"), image: "scope" },
    ...(tab
      ? [{ id: "reload", title: t("mobile.browser.reload"), image: "arrow.clockwise" } satisfies MenuAction]
      : []),
    ...(takeover
      ? [
          {
            id: "hand-back",
            title: t("mobile.chat.browserSecret.done"),
            image: "checkmark.circle",
          } satisfies MenuAction,
        ]
      : []),
  ];
  const clipboardActions: MenuAction[] = [
    { id: "paste", title: t("mobile.browser.pasteFromPhone"), image: "doc.on.clipboard" },
    ...(support.clipboard
      ? [{ id: "copy", title: t("mobile.browser.copyToPhone"), image: "doc.on.doc" } satisfies MenuAction]
      : []),
  ];

  const status = (() => {
    if (!allowed) return { text: t("mobile.browser.status.off"), action: null };
    if (!online) return { text: t("mobile.browser.status.offline"), action: null };
    if (!support.view) return { text: t("mobile.browser.status.unsupported"), action: null };
    if (!tab) return { text: t("mobile.browser.status.noTab", { name: agent.name }), action: null };
    if (live.status.kind === "connecting") return { text: t("mobile.browser.status.connecting"), action: null };
    if (live.status.kind === "offline")
      return { text: t("mobile.browser.status.offline"), action: "reconnect" as const };
    if (live.status.kind === "ended")
      return {
        text: live.status.reason ? sourceText(live.status.reason) : t("mobile.browser.status.ended"),
        action: "reconnect" as const,
      };
    return null;
  })();
  const canUseTab = ready && tab !== null;
  // The bar acts on the host's tabs, so it shows only for a host and an app version that allow it:
  // the tab's controls, or one New tab button when the agent has no tab.
  const showControls = allowed && support.view && tab !== null;
  const showNewTab = allowed && support.view && tab === null;
  const controlBottom = keyboardShown ? CONTROL_OFFSET : insets.bottom + CONTROL_OFFSET;

  useProvideBrowserSheetControls(agent.serverId, agent.id, {
    tabId: tab?.id ?? null,
    unseenTabIds: unseenTabs,
    canUseTab,
    openingTab,
    navigate,
    reload,
    loadUrl,
    openTab: () => void openTab(NEW_TAB_URL),
    closeTab: (closedId) => void closeTab(closedId),
    chooseTab: onChooseTab,
  });

  const openSheet = () => {
    void haptics.impact("soft");
    keyboardField.current?.blur();
    router.push({ pathname: "/browser-tabs/[agentId]", params: { agentId: agent.id, serverId: agent.serverId } });
  };

  return (
    <View className="flex-1 bg-background">
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <View style={{ flex: 1 }}>
          <BrowserLiveStage
            ref={stage}
            image={live.image}
            frame={live.frame}
            cursor={live.cursor}
            mode={mode}
            drawnSequence={live.drawnSequence}
            send={ready ? live.send : ignoreInput}
            accessibilityLabel={t("mobile.browser.liveView", { title: tab?.title || agent.name })}
          />
          {pageMenu ? (
            <MenuView
              ref={pageMenuView}
              actions={pageMenu.actions}
              onPressAction={({ nativeEvent }) => pageMenu.run.get(nativeEvent.event)?.()}
              onCloseMenu={() => setPageMenu(null)}
              style={{ position: "absolute", left: pageMenu.at.x, top: pageMenu.at.y, width: 1, height: 1 }}
            >
              <View style={{ width: 1, height: 1 }} />
            </MenuView>
          ) : null}
          {status ? (
            <View
              pointerEvents="box-none"
              className={`absolute inset-0 items-center justify-center gap-4 ${live.frame ? "bg-background/60" : ""}`}
              style={{ paddingLeft: insets.left + 32, paddingRight: insets.right + 32 }}
            >
              <Typography.Paragraph align="center" className="text-muted">
                {status.text}
              </Typography.Paragraph>
              {status.action === "reconnect" && online ? (
                <Button
                  variant="secondary"
                  onPress={() => {
                    void haptics.impact("soft");
                    onReconnect();
                  }}
                >
                  <Button.Label>{t("mobile.browser.reconnect")}</Button.Label>
                </Button>
              ) : null}
            </View>
          ) : null}
          {notice ? (
            <Animated.View
              key={notice}
              entering={reducedMotion ? undefined : FadeIn.duration(160)}
              exiting={reducedMotion ? undefined : FadeOut.duration(160)}
              pointerEvents="none"
              accessibilityLiveRegion="polite"
              className="absolute self-center rounded-full bg-control px-4 py-2"
              style={{ bottom: controlBottom + CONTROL_SIZE + 12 }}
            >
              <Typography.Paragraph type="body-sm">{notice}</Typography.Paragraph>
            </Animated.View>
          ) : null}
          {/* The controls and the New tab button share one place, and one fades into the other. */}
          <View
            pointerEvents="box-none"
            className="absolute inset-x-0"
            style={{ bottom: controlBottom, height: CONTROL_SIZE }}
          >
            <View
              pointerEvents="box-none"
              className="absolute inset-0 flex-row items-center justify-between"
              // Clear of the side insets: the rail of iPhone Duo and the edges in landscape.
              style={{ paddingLeft: insets.left + 16, paddingRight: insets.right + 16 }}
            >
              <ChatGlassIconButton
                accessibilityLabel={t("mobile.browser.previousPage")}
                fallbackBackground={fieldBackground}
                liquidGlassAvailable={liquidGlass}
                disabled={!canUseTab}
                hidden={!showControls}
                onPress={() => navigate("back")}
              >
                <ChevronLeft color={iconColor} size={24} strokeWidth={2} />
              </ChatGlassIconButton>
              <ChatGlassIconButton
                accessibilityLabel={t("mobile.browser.nextPage")}
                fallbackBackground={fieldBackground}
                liquidGlassAvailable={liquidGlass}
                disabled={!canUseTab}
                hidden={!showControls}
                onPress={() => navigate("forward")}
              >
                <ChevronRight color={iconColor} size={24} strokeWidth={2} />
              </ChatGlassIconButton>
              <HideableMenu hidden={!showControls}>
                <MenuView
                  actions={clipboardActions}
                  onPressAction={({ nativeEvent }) => {
                    if (!ready) return;
                    if (nativeEvent.event === "paste") void paste();
                    else if (nativeEvent.event === "copy") void copy();
                  }}
                  style={{ height: CONTROL_SIZE, width: CONTROL_SIZE }}
                >
                  <GlassCircle liquidGlass={liquidGlass} fallbackBackground={fieldBackground} hidden={!showControls}>
                    <View
                      accessible
                      accessibilityRole="button"
                      accessibilityLabel={t("mobile.browser.clipboard")}
                      className="flex-1 items-center justify-center"
                    >
                      <ClipboardList color={iconColor} size={22} strokeWidth={2} />
                    </View>
                  </GlassCircle>
                </MenuView>
              </HideableMenu>
              <ChatGlassIconButton
                accessibilityLabel={
                  keyboardShown ? t("mobile.browser.keyboard.hide") : t("mobile.browser.keyboard.show")
                }
                fallbackBackground={fieldBackground}
                liquidGlassAvailable={liquidGlass}
                disabled={!ready}
                hidden={!showControls}
                onPress={toggleKeyboard}
              >
                <Keyboard color={iconColor} size={22} strokeWidth={2} />
              </ChatGlassIconButton>
              <View>
                <ChatGlassIconButton
                  accessibilityLabel={t("mobile.browser.tabs.button", { count: tabs.length })}
                  fallbackBackground={fieldBackground}
                  liquidGlassAvailable={liquidGlass}
                  hidden={!showControls}
                  accessibilityValue={
                    unseenTabs.size > 0 ? { text: t("mobile.browser.tabs.openedInBackground") } : undefined
                  }
                  onPress={openSheet}
                >
                  <View
                    className="items-center justify-center"
                    style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: iconColor }}
                  >
                    <Typography.Paragraph type="body-xs" weight="semibold">
                      {format.number(tabs.length)}
                    </Typography.Paragraph>
                  </View>
                </ChatGlassIconButton>
                {showControls && unseenTabs.size > 0 ? (
                  <View
                    pointerEvents="none"
                    className="absolute top-0 right-0 size-3 rounded-full border-2 border-background bg-accent"
                  />
                ) : null}
              </View>
            </View>
            <View pointerEvents="box-none" className="absolute inset-0 items-center justify-center">
              <ChatGlassButton
                accessibilityLabel={t("mobile.browser.tabs.new")}
                className="h-12 items-center justify-center px-5"
                fallbackBackground={fieldBackground}
                liquidGlassAvailable={liquidGlass}
                disabled={openingTab}
                hidden={!showNewTab}
                onPress={() => {
                  void haptics.impact("soft");
                  void openTab(NEW_TAB_URL);
                }}
              >
                <View className="flex-row items-center gap-2">
                  <Plus color={iconColor} size={20} strokeWidth={2} />
                  <Typography.Paragraph weight="semibold">{t("mobile.browser.tabs.new")}</Typography.Paragraph>
                </View>
              </ChatGlassButton>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>

      <View
        className="absolute inset-x-0 z-20 flex-row items-center gap-3"
        pointerEvents="box-none"
        style={{ top: insets.top + CONTROL_OFFSET, paddingLeft: insets.left + 16, paddingRight: insets.right + 16 }}
      >
        <ChatGlassIconButton
          accessibilityLabel={t("common.back")}
          fallbackBackground={fieldBackground}
          liquidGlassAvailable={liquidGlass}
          onPress={() => {
            void haptics.impact("soft");
            router.back();
          }}
        >
          <ArrowLeft color={iconColor} size={24} strokeWidth={2} />
        </ChatGlassIconButton>
        {choices.length > 0 ? (
          // In a channel where several agents work, the name switches to the browser of another one.
          <MenuView
            actions={choices.map((choice) => ({
              id: choice.id,
              title: choice.name,
              state: choice.id === agent.id ? "on" : "off",
            }))}
            onPressAction={({ nativeEvent }) => {
              if (nativeEvent.event === agent.id || !choices.some((choice) => choice.id === nativeEvent.event)) return;
              void haptics.selection();
              onChooseAgent(nativeEvent.event);
            }}
            style={{ minWidth: 0, flexShrink: 1 }}
          >
            <GlassCapsule liquidGlass={liquidGlass} fallbackBackground={fieldBackground}>
              <View
                accessible
                accessibilityRole="button"
                accessibilityLabel={t("mobile.browser.switchAgent", { name: agent.name })}
                className="min-w-0 shrink flex-row items-center gap-2 pr-3.5 pl-2.5"
                style={{ height: CONTROL_SIZE }}
              >
                <BloubAvatar
                  agentId={agent.id}
                  serverId={agent.serverId}
                  hue={agent.avatarHue}
                  seed={agent.avatarSeed}
                  size={28}
                />
                <Typography.Paragraph className="min-w-0 shrink" weight="semibold" numberOfLines={1}>
                  {agent.name}
                </Typography.Paragraph>
                <ChevronsUpDown color={iconColor} size={16} strokeWidth={2} />
              </View>
            </GlassCapsule>
          </MenuView>
        ) : (
          <View className="min-w-0 shrink flex-row items-center gap-2" accessibilityRole="header">
            <BloubAvatar
              agentId={agent.id}
              serverId={agent.serverId}
              hue={agent.avatarHue}
              seed={agent.avatarSeed}
              size={28}
            />
            <Typography.Paragraph className="min-w-0 shrink" weight="semibold" numberOfLines={1}>
              {agent.name}
            </Typography.Paragraph>
          </View>
        )}
        <View className="flex-1" />
        <ChatGlassIconButton
          accessibilityLabel={t("mobile.browser.help")}
          fallbackBackground={fieldBackground}
          liquidGlassAvailable={liquidGlass}
          onPress={() => {
            void haptics.impact("soft");
            router.push("/browser-help");
          }}
        >
          <CircleQuestionMark color={iconColor} size={24} strokeWidth={2} />
        </ChatGlassIconButton>
        <MenuView
          actions={options}
          onPressAction={({ nativeEvent }) => {
            if (nativeEvent.event === "trackpad") {
              void haptics.selection();
              const next = mode === "trackpad" ? "direct" : "trackpad";
              rememberedMode = next;
              setMode(next);
            } else if (nativeEvent.event === "recenter") {
              void haptics.impact("soft");
              stage.current?.recenterPointer();
            } else if (nativeEvent.event === "reload") {
              reload();
            } else if (nativeEvent.event === "hand-back") {
              void handBack();
            }
          }}
          style={{ height: CONTROL_SIZE, width: CONTROL_SIZE }}
        >
          <GlassCircle liquidGlass={liquidGlass} fallbackBackground={fieldBackground}>
            <View
              accessible
              accessibilityRole="button"
              accessibilityLabel={t("mobile.browser.options")}
              className="flex-1 items-center justify-center"
            >
              <Ellipsis color={iconColor} size={24} strokeWidth={2} />
            </View>
          </GlassCircle>
        </MenuView>
      </View>

      {/* The phone keyboard types into this field. What changes in it goes to the page. */}
      <TextInput
        ref={keyboardField}
        accessibilityLabel={t("mobile.browser.keyboard.field")}
        autoCapitalize="none"
        autoComplete="off"
        autoCorrect={false}
        caretHidden
        contextMenuHidden
        importantForAutofill="no"
        keyboardAppearance={appearance}
        multiline
        smartInsertDelete={false}
        spellCheck={false}
        textContentType="none"
        style={{ position: "absolute", left: -100, top: 0, width: 1, height: 1, opacity: 0 }}
        onFocus={() => setKeyboardShown(true)}
        onBlur={() => setKeyboardShown(false)}
        onChangeText={(text) => {
          sendKeys(textChangeInputs(typed.current, text));
          typed.current = text;
          if (text.length > KEYBOARD_FIELD_MAX_LENGTH) {
            keyboardField.current?.clear();
            typed.current = "";
          }
        }}
        onKeyPress={(event: TextInputKeyPressEvent) => {
          // Backspace in an empty field changes no text, so the change handler never hears it.
          if (event.nativeEvent.key === "Backspace" && typed.current === "") sendKeys(namedKeyInputs("Backspace"));
        }}
      />
    </View>
  );
}

function ignoreInput() {}

/**
 * A glass circle of the control size, as the chat header draws one. The menu owns the touch. Hidden,
 * it fades as `ChatGlassButton` does: the glass turns to `none` with its native animation, because
 * glass stops rendering under an ancestor with no opacity, and only the content fades.
 */
function GlassCircle({
  liquidGlass,
  fallbackBackground,
  hidden = false,
  children,
}: {
  liquidGlass: boolean;
  fallbackBackground: ViewStyle["backgroundColor"];
  hidden?: boolean;
  children: ReactNode;
}) {
  return (
    <GlassView
      glassEffectStyle={{ style: liquidGlass && !hidden ? "regular" : "none", animate: true, animationDuration: 0.2 }}
      style={{
        width: CONTROL_SIZE,
        height: CONTROL_SIZE,
        borderRadius: CONTROL_SIZE / 2,
        borderCurve: "continuous",
        overflow: "hidden",
        backgroundColor: "transparent",
      }}
    >
      {liquidGlass ? null : (
        <Animated.View
          pointerEvents="none"
          style={{
            position: "absolute",
            inset: 0,
            backgroundColor: fallbackBackground,
            opacity: hidden ? 0 : 1,
            ...FADE,
          }}
        />
      )}
      <Animated.View style={{ flex: 1, opacity: hidden ? 0 : 1, ...FADE }}>{children}</Animated.View>
    </GlassView>
  );
}

/** A glass capsule of the control height, as the chat header draws its title. The menu owns the touch. */
function GlassCapsule({
  liquidGlass,
  fallbackBackground,
  children,
}: {
  liquidGlass: boolean;
  fallbackBackground: ViewStyle["backgroundColor"];
  children: ReactNode;
}) {
  return (
    <GlassView
      glassEffectStyle={liquidGlass ? "regular" : "none"}
      style={{
        height: CONTROL_SIZE,
        borderRadius: CONTROL_SIZE / 2,
        borderCurve: "continuous",
        overflow: "hidden",
        flexShrink: 1,
        backgroundColor: liquidGlass ? "transparent" : fallbackBackground,
      }}
    >
      {children}
    </GlassView>
  );
}

/** A menu that takes no touch and is not read out while its button is hidden. */
function HideableMenu({ hidden, children }: { hidden: boolean; children: ReactNode }) {
  return (
    <View
      pointerEvents={hidden ? "none" : "auto"}
      accessibilityElementsHidden={hidden}
      importantForAccessibility={hidden ? "no-hide-descendants" : "auto"}
    >
      {children}
    </View>
  );
}
