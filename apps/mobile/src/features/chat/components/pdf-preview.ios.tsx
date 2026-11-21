import { File } from "expo-file-system";
import * as Linking from "expo-linking";
import { useThemeColor } from "heroui-native/hooks";
import { WebView } from "react-native-webview";
import type { DocumentPreviewProps } from "./file-document-preview";

export function PdfPreview({ uri, title, insets }: DocumentPreviewProps) {
  const [background] = useThemeColor(["background"]);
  return (
    <WebView
      source={{ uri }}
      originWhitelist={["*"]}
      allowingReadAccessToURL={new File(uri).parentDirectory.uri}
      javaScriptEnabled={false}
      contentInset={{ top: insets.top, bottom: insets.bottom }}
      contentInsetAdjustmentBehavior="never"
      onShouldStartLoadWithRequest={(request) => {
        if (request.url.startsWith("file:")) return true;
        if (/^https?:/u.test(request.url)) void Linking.openURL(request.url);
        return false;
      }}
      accessibilityLabel={title}
      style={{ flex: 1, backgroundColor: String(background) }}
    />
  );
}
