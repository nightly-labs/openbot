import MaskedView from "@react-native-masked-view/masked-view";
import { Typography } from "heroui-native";
import { Monitor } from "lucide-react-native";
import { View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { useCSSVariable } from "uniwind";
import { getBloubAvatarColor, thumbnailColor } from "@/features/agents/components/bloub-avatar";
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

/** A squircle in the agent avatar palette, with a dot for the connection state. */
export function ServerAvatar({ server, size = 48 }: { server: MobileServer; size?: number }) {
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
  const muted = server.state !== "online";
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
        <View
          className="items-center justify-center"
          style={{
            backgroundColor: thumbnailColor(getBloubAvatarColor(server.id, null), muted),
            borderCurve: "continuous",
            borderRadius: size * 0.32,
            height: size,
            opacity: muted ? DISCONNECTED_APPEARANCE.opacity : 1,
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
        </View>
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
