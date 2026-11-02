import { Image } from "expo-image";
import LinkIcon from "lucide-react-native/icons/link";
import { memo, useState } from "react";
import { type ColorValue, View } from "react-native";

/** Sites with no favicon, so that a message drawn again does not ask them again. */
const missingFavicons = new Set<string>();

function faviconUrl(url: string): string | null {
  const { protocol, origin } = new URL(url);
  return protocol === "https:" || protocol === "http:" ? `${origin}/favicon.ico` : null;
}

/** The linked site's favicon, as on desktop and web. The link symbol shows until it loads, and when it does not. */
export const ChatLinkIcon = memo(function ChatLinkIcon({
  url,
  favicon: showFavicon,
  color,
  compact,
}: {
  url: string;
  /** False keeps the request for the linked site's favicon from being made. */
  favicon: boolean;
  color: ColorValue | undefined;
  compact: boolean;
}) {
  const size = compact ? 12 : 14;
  const favicon = showFavicon ? faviconUrl(url) : null;
  const [loaded, setLoaded] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const shown = favicon !== null && favicon !== failed && !missingFavicons.has(favicon);

  return (
    <View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={{ width: size, height: size }}
    >
      {shown && loaded === favicon ? null : <LinkIcon color={String(color)} size={size} strokeWidth={1.8} />}
      {shown ? (
        <Image
          source={{ uri: favicon }}
          contentFit="contain"
          style={{ position: "absolute", width: size, height: size, borderRadius: 2 }}
          onLoad={() => setLoaded(favicon)}
          onError={() => {
            missingFavicons.add(favicon);
            setFailed(favicon);
          }}
        />
      ) : null}
    </View>
  );
});
