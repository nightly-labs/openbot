import {
  DISCORD_MARK_PATH,
  GITHUB_MARK_PATH,
  ONEPASSWORD_MARK_PATH,
  SLACK_MARK_PATH,
  TELEGRAM_MARK_PATH,
} from "@openbot/brand/connector-mark-shape";
import { useThemeColor } from "heroui-native/hooks";
import Lock from "lucide-react-native/icons/lock";
import { View } from "react-native";
import Svg, { Path } from "react-native-svg";
import type { MobileConnectorId } from "@/features/servers/model/connectors";

const MARK_PATHS: Record<Exclude<MobileConnectorId, "bitwarden">, string> = {
  slack: SLACK_MARK_PATH,
  discord: DISCORD_MARK_PATH,
  telegram: TELEGRAM_MARK_PATH,
  github: GITHUB_MARK_PATH,
  onepassword: ONEPASSWORD_MARK_PATH,
};

/** The connector's mark on a tile, as desktop Server settings › Connectors shows it. */
export function ConnectorLogo({ id, size = 32 }: { id: MobileConnectorId; size?: number }) {
  const foreground = useThemeColor("foreground");
  const mark = Math.round(size * 0.55);
  return (
    <View
      className="items-center justify-center bg-control"
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.28) }}
    >
      {id === "bitwarden" ? (
        <Lock size={mark} color={foreground} strokeWidth={1.75} />
      ) : (
        <Svg width={mark} height={mark} viewBox="0 0 24 24">
          <Path d={MARK_PATHS[id]} fill={foreground} />
        </Svg>
      )}
    </View>
  );
}
