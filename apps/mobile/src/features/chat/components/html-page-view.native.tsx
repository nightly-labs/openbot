import { chatVisualAppTheme, chatVisualDocument } from "@openbot/contracts/chat-visual";
import * as Linking from "expo-linking";
import { useMemo, useRef } from "react";
import { Platform, View } from "react-native";
import { WebView } from "react-native-webview";
import { useUniwind } from "uniwind";
import type { HtmlPageProps } from "./html-page";

/** The margin of a page on the preview screen, as the desktop file panel gives it. */
const PAGE_MARGIN_Y = 12;
const PAGE_MARGIN_X = 16;
/** A web link opens only this long after a touch on the page. */
const TAP_WINDOW_MS = 1_000;
/**
 * A form that the page does not handle in a script would load another address. Android does not
 * ask `onShouldStartLoadWithRequest` about a POST load, so the policy stops every form submit.
 */
const FORM_POLICY = `<meta http-equiv="Content-Security-Policy" content="form-action 'none'">`;
const PAGE_ADDRESS = "about:blank";
const ANDROID = Platform.OS === "android";

function openWebLink(url: string): void {
  if (/^https?:/iu.test(url)) void Linking.openURL(url);
}

/**
 * The page in a native web view, with the base styles and app theme of a desktop visual page. The
 * canvas is transparent, so a page that sets no colours shows on the app background. The view has
 * no `onMessage` and injects no script, so react-native-webview adds no message handler or
 * JavaScript interface, and the page cannot call the app: do not add either. It loads from a
 * string at `about:blank`, so it cannot read app files. On iOS, `incognito` keeps its storage in
 * memory. On Android, `incognito` clears the cookies and the cache of every web view of the app, so
 * the page gets no DOM storage and no cookies instead.
 *
 * On the screen, the margin and the header space are padding of the page root: the page's own
 * background fills the space under the glass header and the home indicator.
 */
export function HtmlPageView({ source, title, mode, insets = { top: 0, bottom: 0 } }: HtmlPageProps) {
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
  // Android gives no cause for a load, and WebKit calls a script `click()` on a link a click too. So
  // the touch time decides, and a page script cannot open the browser by itself.
  const tapped = () => screen && Date.now() - lastTouch.current < TAP_WINDOW_MS;
  return (
    <View
      style={{ flex: 1 }}
      onTouchStart={() => {
        lastTouch.current = Date.now();
      }}
    >
      <WebView
        source={{ html, baseUrl: PAGE_ADDRESS }}
        // This handler decides every load: the default list opens any other link, of any scheme, itself.
        originWhitelist={["*"]}
        incognito={!ANDROID}
        domStorageEnabled={false}
        thirdPartyCookiesEnabled={false}
        allowsLinkPreview={false}
        contentInsetAdjustmentBehavior="never"
        scrollEnabled={screen}
        onShouldStartLoadWithRequest={(request) => {
          // The page itself and a link to a place in it.
          if (request.url === PAGE_ADDRESS || request.url.startsWith(`${PAGE_ADDRESS}#`)) return true;
          if (ANDROID) {
            // Android asks only about a main-frame load and a frame load that is not a web address.
            if (tapped()) openWebLink(request.url);
            return false;
          }
          // A frame that the page embeds loads freely; the page itself goes to no other address.
          if (!request.isTopFrame) return true;
          if (tapped() && request.navigationType === "click") openWebLink(request.url);
          return false;
        }}
        // A link with a target.
        onOpenWindow={(event) => {
          if (tapped()) openWebLink(event.nativeEvent.targetUrl);
        }}
        accessibilityLabel={title}
        style={{ flex: 1, backgroundColor: "transparent" }}
      />
    </View>
  );
}
