import MaskedView from "@react-native-masked-view/masked-view";
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { Typography } from "heroui-native";
import { Monitor } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { useCSSVariable } from "uniwind";
import { getBloubAvatarColor, thumbnailColor } from "@/features/agents/components/bloub-avatar";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { loadServerLogo } from "@/features/servers/model/server-logo";
import { DISCONNECTED_APPEARANCE } from "@/features/workspace/components/use-connection-appearance";
import type { MobileServer } from "@/features/workspace/model/workspace-types";

const INK = "rgba(0, 0, 0, 0.72)";
const DOT = 12;
const DOT_OVERHANG = 2;
// The ring cut out of the squircle around the dot, so the dot works on any background.
const DOT_GAP = 2.5;

/** A square with a circular hole around the dot. The mask keeps only the filled part. */
function cutoutPath(size: number): string {
  const center = size + DOT_OVERHANG - DOT / 2;
  const radius = DOT / 2 + DOT_GAP;
  return `M0 0H${size}V${size}H0Z M${center - radius} ${center}a${radius} ${radius} 0 1 0 ${radius * 2} 0a${radius} ${radius} 0 1 0 ${-radius * 2} 0Z`;
}

function serverInitials(name: string): string {
  const words = name
    .trim()
    .split(/[\s_-]+/u)
    .filter(Boolean);
  const initials = words.length > 1 ? `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}` : (words[0]?.slice(0, 2) ?? "");
  return initials.toUpperCase() || "S";
}

/**
 * A squircle with the server logo, or with initials in the agent avatar palette, and a dot for the
 * connection state. `logoUri` replaces the saved logo with a draft; `null` shows no logo.
 * `showStatus={false}` leaves out the dot and the dimming, for a place that shows the logo only.
 */
export function ServerAvatar({
  server,
  size = 48,
  logoUri,
  showStatus = true,
}: {
  server: MobileServer;
  size?: number;
  logoUri?: string | null;
  showStatus?: boolean;
}) {
  const { session, sessionScope } = useMobileSession();
  const { logoKey } = server;
  const saved = useQuery({
    queryKey: ["server-logo", session?.apiUrl, session?.user.id, sessionScope, server.id, logoKey],
    enabled: logoUri === undefined && Boolean(session && logoKey),
    queryFn: () => {
      if (!session || !logoKey) throw new Error("The server logo is unavailable.");
      return loadServerLogo(session, server.id, logoKey);
    },
    // The event that names a new logo can arrive before the host has uploaded it.
    retry: 4,
    staleTime: Infinity,
  });
  const logo = logoUri === undefined ? (saved.data ?? null) : logoUri;
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const logoFailed = logo === failedUri;
  const success = String(useCSSVariable("--openbot-success"));
  const warning = String(useCSSVariable("--openbot-warning"));
  const danger = String(useCSSVariable("--openbot-danger"));
  const offline = String(useCSSVariable("--openbot-text-dim"));
  const dot =
    server.state === "online"
      ? success
      : server.state === "error"
        ? danger
        : server.state === "connecting" && server.initialConnectionPending
          ? warning
          : offline;
  const muted = showStatus && server.state !== "online";
  const tile = (
    <View
      className="items-center justify-center"
      style={{
        backgroundColor: thumbnailColor(getBloubAvatarColor(server.id, null), muted),
        borderCurve: "continuous",
        borderRadius: size * 0.32,
        height: size,
        opacity: muted ? DISCONNECTED_APPEARANCE.opacity : 1,
        overflow: "hidden",
        width: size,
      }}
    >
      {server.kind === "local" ? (
        <Monitor color={INK} size={size * 0.42} strokeWidth={2} />
      ) : (
        <Typography weight="semibold" style={{ color: INK, fontSize: size * 0.32, lineHeight: size * 0.42 }}>
          {serverInitials(server.name)}
        </Typography>
      )}
      {logo && !logoFailed ? (
        <Image
          source={{ uri: logo }}
          contentFit="cover"
          recyclingKey={logo}
          style={{ height: size, position: "absolute", width: size }}
          onError={() => setFailedUri(logo)}
        />
      ) : null}
    </View>
  );
  if (!showStatus)
    return (
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {tile}
      </View>
    );
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <MaskedView
        style={{ height: size, width: size }}
        maskElement={
          <Svg height={size} width={size}>
            <Path d={cutoutPath(size)} fill="#000" fillRule="evenodd" />
          </Svg>
        }
      >
        {tile}
      </MaskedView>
      <View
        className="absolute rounded-full"
        style={{
          backgroundColor: dot,
          bottom: -DOT_OVERHANG,
          height: DOT,
          right: -DOT_OVERHANG,
          width: DOT,
        }}
      />
    </View>
  );
}
