import { chatVisualAppTheme, chatVisualDocument } from "@openbot/contracts/chat-visual";
import * as Linking from "expo-linking";
import { useMemo, useRef } from "react";
import { Platform, View } from "react-native";
import { WebView } from "react-native-webview";
import { useUniwind } from "uniwind";
import type { HtmlPageProps } from "./html-page";

const PAGE_MARGIN_Y = 12;
const PAGE_MARGIN_X = 16;
const TAP_WINDOW_MS = 1_000;
const FORM_POLICY = `<meta http-equiv="Content-Security-Policy" content="form-action 'none'">`;
const PAGE_ADDRESS = "about:blank";
const ANDROID = Platform.OS === "android";

const HEIGHT_REPORT = `(()=>{const root=document.documentElement;let last=-1,queued=false;const report=()=>{queued=false;const height=Math.ceil(root.getBoundingClientRect().height);if(height===last)return;last=height;window.ReactNativeWebView.postMessage(String(height));};const queue=()=>{if(queued)return;queued=true;requestAnimationFrame(report);};new ResizeObserver(queue).observe(root);report();})();true;`;

function openWebLink(url: string): void {
  if (/^https?:/iu.test(url)) void Linking.openURL(url);
}

export function HtmlPageView({ source, title, mode, insets = { top: 0, bottom: 0 }, onHeight }: HtmlPageProps) {
  const { theme } = useUniwind();
  const appearance = theme === "dark" ? "dark" : "light";
  const screen = mode === "screen";
  const lastTouch = useRef(0);
  const html = useMemo(() => {
    const padding = `${insets.top + PAGE_MARGIN_Y}px ${PAGE_MARGIN_X}px ${insets.bottom + PAGE_MARGIN_Y}px`;
    return chatVisualDocument(source, {
      theme: { ...chatVisualAppTheme(appearance), "--background": "transparent" },
      appearance,
      bootstrap: false,
      head: `${FORM_POLICY}${screen ? `<style>:root{padding:${padding}}</style>` : ""}`,
    });
  }, [source, appearance, screen, insets.top, insets.bottom]);
  const tapped = () => screen && Date.now() - lastTouch.current < TAP_WINDOW_MS;
  const measured = !screen && onHeight ? onHeight : undefined;
  return (
    <View
      style={{ flex: 1 }}
      onTouchStart={() => {
        lastTouch.current = Date.now();
      }}
    >
      <WebView
        key={measured ? "measured" : "fixed"}
        source={{ html, baseUrl: PAGE_ADDRESS }}
        originWhitelist={["*"]}
        incognito={!ANDROID}
        domStorageEnabled={false}
        thirdPartyCookiesEnabled={false}
        allowsLinkPreview={false}
        contentInsetAdjustmentBehavior="never"
        scrollEnabled={screen}
        injectedJavaScript={measured ? HEIGHT_REPORT : undefined}
        onMessage={
          measured
            ? (event: { nativeEvent: { data: string } }) => {
                const height = Number(event.nativeEvent.data);
                if (Number.isFinite(height) && height > 0) measured(height);
              }
            : undefined
        }
        onShouldStartLoadWithRequest={(request) => {
          if (request.url === PAGE_ADDRESS || request.url.startsWith(`${PAGE_ADDRESS}#`)) return true;
          if (ANDROID) {
            if (tapped()) openWebLink(request.url);
            return false;
          }
          if (!request.isTopFrame) return true;
          if (tapped() && request.navigationType === "click") openWebLink(request.url);
          return false;
        }}
        onOpenWindow={(event) => {
          if (tapped()) openWebLink(event.nativeEvent.targetUrl);
        }}
        accessibilityLabel={title}
        style={{ flex: 1, backgroundColor: "transparent" }}
      />
    </View>
  );
}
