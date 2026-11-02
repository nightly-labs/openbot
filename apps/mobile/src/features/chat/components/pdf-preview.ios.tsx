import { File } from "expo-file-system";
import * as Linking from "expo-linking";
import { useThemeColor } from "heroui-native/hooks";
import { WebView } from "react-native-webview";
import type { DocumentPreviewProps } from "./file-document-preview";

/**
 * A PDF file in a web view, which draws a PDF natively with zoom and text selection. The view runs no
 * scripts and opens a web link of the document in the browser.
 */
export function PdfPreview({ uri, title, insets }: DocumentPreviewProps) {
  const [background] = useThemeColor(["background"]);
  return (
    <WebView
      source={{ uri }}
      // This handler decides every load: the default list opens any other link, of any scheme, itself.
      originWhitelist={["*"]}
      allowingReadAccessToURL={new File(uri).parentDirectory.uri}
      javaScriptEnabled={false}
      contentInset={{ top: insets.top, bottom: insets.bottom }}
      contentInsetAdjustmentBehavior="never"
      onShouldStartLoadWithRequest={(request) => {
        // The file itself, which can read only its own folder. The URL can encode the name in another way.
        if (request.url.startsWith("file:")) return true;
        if (/^https?:/u.test(request.url)) void Linking.openURL(request.url);
        return false;
      }}
      accessibilityLabel={title}
      style={{ flex: 1, backgroundColor: String(background) }}
    />
  );
}
