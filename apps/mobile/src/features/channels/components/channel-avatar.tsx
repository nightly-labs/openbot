import type { ChannelSummary } from "@openbot/contracts/ipc";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import Folder from "lucide-react-native/icons/folder";
import { memo } from "react";
import { View } from "react-native";
import { BloubAvatarThumbnail } from "@/features/agents/components/bloub-avatar";
import type { MobileAgent } from "@/features/workspace/model/workspace-types";
import { useText } from "@/shared/lib/text";

/*
 * The members in the square one agent avatar occupies, as the desktop sidebar draws them, so a
 * channel row keeps the shape of the agent rows around it. The face centres sit `PITCH` apart and
 * each face box is `FACE` of the square. The plush body is about 0.73 of its face box (radius 100 of
 * the 316 view box, drawn at `PLUSH_BODY_SCALE`), so a body is about 0.46 of the square: wider than
 * the pitch, so the faces squeeze together, and a later face paints over an earlier one. The pair
 * still ends inside the square. One member fills the square, two sit side by side, three read as a
 * triangle. Past four, the last cell is the count; a count of two digits takes the whole bottom row,
 * under two faces.
 */
const CELLS = 4;
const PITCH = 0.34;
const FACE = 0.63;
const COUNT = 0.46;

type Cell = readonly [x: number, y: number];
const LEFT = -PITCH / 2;
const RIGHT = PITCH / 2;
const TOP = -PITCH / 2;
const BOTTOM = PITCH / 2;
// Face centres as offsets from the middle of the square, in shares of its size, by face count.
const LAYOUTS: Readonly<Record<number, readonly Cell[]>> = {
  2: [
    [LEFT, 0],
    [RIGHT, 0],
  ],
  3: [
    [LEFT, TOP],
    [RIGHT, TOP],
    [0, BOTTOM],
  ],
  4: [
    [LEFT, TOP],
    [RIGHT, TOP],
    [LEFT, BOTTOM],
    [RIGHT, BOTTOM],
  ],
};

export const ChannelAvatar = memo(function ChannelAvatar({
  channel,
  agents,
  size,
  disconnected = false,
}: {
  channel: Pick<ChannelSummary, "members">;
  agents: ReadonlyMap<string, MobileAgent>;
  size: number;
  disconnected?: boolean;
}) {
  const muted = useThemeColor("muted");
  const total = channel.members.length;
  const faceCount = total <= CELLS ? total : total - (CELLS - 1) >= 10 ? CELLS - 2 : CELLS - 1;
  const hidden = total - faceCount;
  const single = total === 1;
  // Whole pixels keep the plush picture cache on the same entry for every row of one size.
  const face = single ? size : Math.round(size * FACE);
  const cells = LAYOUTS[hidden > 0 ? faceCount + 1 : faceCount] ?? [[0, 0]];
  return (
    <View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}
    >
      {!total ? <Folder color={String(muted)} size={size * 0.56} /> : null}
      {channel.members.slice(0, faceCount).map((member, index) => {
        const agent = agents.get(member.agentId);
        const [x, y] = cells[index] ?? [0, 0];
        return (
          <View
            key={member.agentId}
            style={{
              position: "absolute",
              left: size / 2 + x * size - face / 2,
              top: size / 2 + y * size - face / 2,
            }}
          >
            <BloubAvatarThumbnail
              agentId={agent?.id}
              serverId={agent?.serverId}
              disconnected={disconnected}
              seed={agent?.avatarSeed ?? member.agentId}
              hue={agent?.avatarHue ?? null}
              color={agent?.avatarColor ?? null}
              size={face}
            />
          </View>
        );
      })}
      {hidden > 0 ? <HiddenCount count={hidden} size={size} cell={cells[faceCount] ?? [0, 0]} /> : null}
    </View>
  );
});

function HiddenCount({ count, size, cell }: { count: number; size: number; cell: Cell }) {
  const { t, format } = useText();
  const disc = Math.round(size * COUNT);
  const [x, y] = cell;
  // The type follows the disc, so the count fits the small header avatar as well as a list row.
  const fontSize = Math.max(8, Math.round(disc * 0.55));
  return (
    // A box of the cell's width centres the disc on its cell, also when a wide count grows it into a
    // pill. A count of two digits is centred on the bottom row.
    <View
      style={{
        position: "absolute",
        left: count >= 10 ? 0 : size / 2 + x * size - disc / 2,
        width: count >= 10 ? size : disc,
        top: size / 2 + y * size - disc / 2,
        alignItems: "center",
      }}
    >
      <View
        className="bg-default"
        style={{
          minWidth: disc,
          height: disc,
          paddingHorizontal: 1,
          borderRadius: disc / 2,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Typography
          type="body-xs"
          className="font-semibold text-text-secondary"
          style={{ fontSize, lineHeight: fontSize * 1.2, fontVariant: ["tabular-nums"], letterSpacing: -0.4 }}
          numberOfLines={1}
        >
          {t("mobile.channel.avatar.more", { count: format.number(count) })}
        </Typography>
      </View>
    </View>
  );
}
