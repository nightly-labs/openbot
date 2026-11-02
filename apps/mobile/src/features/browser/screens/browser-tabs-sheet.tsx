import * as Clipboard from "expo-clipboard";
import { router, useLocalSearchParams } from "expo-router";
import { Button, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import type { LucideIcon } from "lucide-react-native";
import Check from "lucide-react-native/icons/check";
import ChevronLeft from "lucide-react-native/icons/chevron-left";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import CircleX from "lucide-react-native/icons/circle-x";
import Globe from "lucide-react-native/icons/globe";
import Link2 from "lucide-react-native/icons/link-2";
import Plus from "lucide-react-native/icons/plus";
import RotateCw from "lucide-react-native/icons/rotate-cw";
import Share2 from "lucide-react-native/icons/share-2";
import X from "lucide-react-native/icons/x";
import { useEffect, useRef, useState } from "react";
import { Pressable, Share, TextInput, type TextInputInstance, View } from "react-native";
import { useAgentBrowserTabs } from "@/features/workspace/components/use-live-workspace";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { SheetScrollView } from "@/shared/components/sheet-scroll-view";
import { haptics } from "@/shared/lib/haptics";
import { isIOS } from "@/shared/lib/platform";
import { selectionColorProps } from "@/shared/lib/selection-color";
import { useText } from "@/shared/lib/text";
import { latestBrowserSheetControls, useBrowserSheetControls } from "../model/browser-sheet-bridge";
import { browserAddressUrl, browserTabHost, browserTabTitle } from "../model/browser-tabs";

const COPIED_MS = 1_500;

/**
 * The sheet of the browser's tab button: the address of the tab on screen with its page actions,
 * and the agent's tabs. The browser screen under it does the work.
 */
export function BrowserTabsSheet() {
  const { agentId, serverId } = useLocalSearchParams<{ agentId: string; serverId: string }>();
  const { t } = useText();
  const [foreground, muted, accent] = useThemeColor(["foreground", "muted", "accent"]);
  const iconColor = String(foreground);
  const { conversationStore } = useMobileWorkspace();
  const threadId = conversationStore.get(agentId)?.threadId ?? null;
  const tabs = useAgentBrowserTabs(serverId, agentId, threadId);
  const controls = useBrowserSheetControls(serverId, agentId);
  const tab = tabs.find((candidate) => candidate.id === controls?.tabId) ?? null;
  const canUseTab = controls?.canUseTab === true && tab !== null;
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const addressField = useRef<TextInputInstance>(null);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  /** Runs an action on the browser screen. A page action closes the sheet, so the page shows. */
  const run = (action: (screen: NonNullable<typeof controls>) => void, close = true) => {
    const screen = latestBrowserSheetControls(serverId, agentId);
    if (!screen) return;
    if (close && router.canGoBack()) router.back();
    action(screen);
  };

  const copyLink = async () => {
    if (!tab) return;
    try {
      await Clipboard.setStringAsync(tab.url);
      void haptics.notification("success");
      setCopied(true);
    } catch {
      void haptics.notification("error");
    }
  };

  const share = () => {
    if (!tab) return;
    void haptics.impact("soft");
    Share.share(isIOS ? { url: tab.url } : { message: tab.url }).catch(() => undefined);
  };

  const submit = () => {
    const text = draft.trim();
    setEditing(false);
    if (!text || text === tab?.url) return;
    run((screen) => screen.loadUrl(browserAddressUrl(text)));
  };

  // A page address shows only its site, as the tab list does. The full address is there to edit.
  const shownAddress = tab ? browserTabHost(tab) || tab.url : "";

  return (
    <SheetScrollView contentContainerClassName="gap-4 px-4 pb-safe-offset-5 pt-6" keyboardShouldPersistTaps="handled">
      <View className="h-11 flex-row items-center rounded-full bg-control px-1">
        {editing ? null : (
          <>
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              accessibilityLabel={t("mobile.browser.previousPage")}
              isDisabled={!canUseTab}
              onPress={() => run((screen) => screen.navigate("back"))}
            >
              <ChevronLeft color={iconColor} size={20} strokeWidth={2} />
            </Button>
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              accessibilityLabel={t("mobile.browser.nextPage")}
              isDisabled={!canUseTab}
              onPress={() => run((screen) => screen.navigate("forward"))}
            >
              <ChevronRight color={iconColor} size={20} strokeWidth={2} />
            </Button>
          </>
        )}
        <TextInput
          ref={addressField}
          accessibilityLabel={t("mobile.browser.address.field")}
          autoCapitalize="none"
          autoComplete="off"
          autoCorrect={false}
          className={`h-11 min-w-0 flex-1 font-sans text-foreground ${editing ? "px-3" : "px-1.5"}`}
          editable={controls !== null}
          keyboardType="url"
          placeholder={t("mobile.browser.address.placeholder")}
          placeholderTextColor={String(muted)}
          returnKeyType="go"
          spellCheck={false}
          submitBehavior="blurAndSubmit"
          textContentType="URL"
          {...selectionColorProps(foreground)}
          style={{ fontSize: 16, paddingBottom: 0, paddingTop: 0, textAlignVertical: "center" }}
          value={editing ? draft : shownAddress}
          onChangeText={setDraft}
          onFocus={() => {
            const url = tab?.url ?? "";
            setDraft(url);
            setEditing(true);
            // The field shows the site until it has focus, so the whole address is selected after it shows.
            requestAnimationFrame(() => addressField.current?.setSelection(0, url.length));
          }}
          onBlur={() => setEditing(false)}
          onSubmitEditing={submit}
        />
        {editing ? (
          draft ? (
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              accessibilityLabel={t("mobile.browser.address.clear")}
              onPress={() => setDraft("")}
            >
              <CircleX color={String(muted)} size={18} strokeWidth={2} />
            </Button>
          ) : null
        ) : (
          <>
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              accessibilityLabel={copied ? t("mobile.browser.notice.copied") : t("mobile.browser.menu.copyLink")}
              isDisabled={!tab}
              onPress={() => void copyLink()}
            >
              {copied ? (
                <Check color={String(accent)} size={18} strokeWidth={2} />
              ) : (
                <Link2 color={iconColor} size={18} strokeWidth={2} />
              )}
            </Button>
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              accessibilityLabel={t("mobile.browser.reload")}
              isDisabled={!canUseTab}
              onPress={() => run((screen) => screen.reload())}
            >
              <RotateCw color={iconColor} size={18} strokeWidth={2} />
            </Button>
          </>
        )}
      </View>

      <View className="flex-row gap-3">
        <SheetTile
          icon={Plus}
          iconColor={iconColor}
          label={t("mobile.browser.tabs.new")}
          disabled={!controls || controls.openingTab}
          onPress={() => run((screen) => screen.openTab())}
        />
        <SheetTile
          icon={Share2}
          iconColor={iconColor}
          label={t("mobile.browser.share")}
          disabled={!tab}
          onPress={share}
        />
        <SheetTile
          icon={X}
          iconColor={iconColor}
          label={t("mobile.browser.tabs.close")}
          disabled={!tab}
          onPress={() => run((screen) => tab && screen.closeTab(tab.id), false)}
        />
      </View>

      {tabs.length > 0 ? (
        <View className="gap-2">
          <Typography type="body-xs" className="px-4 text-grouped-secondary">
            {t("mobile.browser.tabs.button", { count: tabs.length })}
          </Typography>
          <View className="overflow-hidden rounded-3xl bg-control">
            {tabs.map((candidate, index) => {
              const title = browserTabTitle(candidate, t("mobile.browser.tabs.untitled"));
              const current = candidate.id === tab?.id;
              const unseen = controls?.unseenTabIds.has(candidate.id) === true;
              return (
                <View key={candidate.id}>
                  {index > 0 ? <View className="ml-14 h-px bg-grouped-border" /> : null}
                  <View className={`min-h-16 flex-row items-center gap-1 pr-2 ${current ? "bg-control-active" : ""}`}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={title}
                      accessibilityValue={unseen ? { text: t("mobile.browser.tabs.openedInBackground") } : undefined}
                      accessibilityState={{ selected: current }}
                      className="min-w-0 flex-1 flex-row items-center gap-3 py-2.5 pl-4"
                      style={({ pressed }) => ({ opacity: pressed ? 0.58 : 1 })}
                      onPress={() =>
                        run((screen) => {
                          void haptics.selection();
                          screen.chooseTab(candidate.id);
                        })
                      }
                    >
                      <View className="size-6 items-center justify-center">
                        {unseen ? (
                          <View className="size-2.5 rounded-full bg-accent" />
                        ) : (
                          <Globe color={String(muted)} size={20} strokeWidth={1.8} />
                        )}
                      </View>
                      <View className="min-w-0 flex-1">
                        <Typography.Paragraph weight={current ? "semibold" : "normal"} numberOfLines={1}>
                          {title}
                        </Typography.Paragraph>
                        <Typography.Paragraph type="body-xs" className="text-muted" numberOfLines={1}>
                          {browserTabHost(candidate) || candidate.url}
                        </Typography.Paragraph>
                      </View>
                    </Pressable>
                    <Button
                      isIconOnly
                      size="sm"
                      variant="ghost"
                      accessibilityLabel={t("mobile.browser.tabs.closeNamed", { title })}
                      onPress={() =>
                        run((screen) => {
                          void haptics.impact("soft");
                          screen.closeTab(candidate.id);
                        }, false)
                      }
                    >
                      <X color={String(muted)} size={18} strokeWidth={2} />
                    </Button>
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      ) : null}
    </SheetScrollView>
  );
}

function SheetTile({
  icon: Icon,
  iconColor,
  label,
  disabled,
  onPress,
}: {
  icon: LucideIcon;
  iconColor: string;
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      className="min-w-0 flex-1 items-center gap-2"
      style={({ pressed }) => ({ opacity: disabled ? 0.45 : pressed ? 0.58 : 1 })}
      onPress={onPress}
    >
      <View
        className="h-18 w-full items-center justify-center rounded-3xl bg-control"
        style={{ borderCurve: "continuous" }}
      >
        <Icon color={iconColor} size={24} strokeWidth={1.9} />
      </View>
      <Typography.Paragraph type="body-xs" className="text-muted" numberOfLines={1}>
        {label}
      </Typography.Paragraph>
    </Pressable>
  );
}
