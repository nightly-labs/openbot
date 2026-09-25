import { HStack, Image, Link, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import {
  background,
  clipShape,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  padding,
  privacySensitive,
  resizable,
} from "@expo/ui/swift-ui/modifiers";
import { Directory, File } from "expo-file-system";
import {
  createLiveActivity,
  type LiveActivityEnvironment,
  type LiveActivityLayout,
  widgetsDirectory,
} from "expo-widgets";
import type { AgentLiveActivityLoader, AgentLiveActivityNative } from "./agent-live-activity.types";
import { renderBloubAvatar } from "./model/live-activity-bloub";
import type { AgentLiveActivityProps } from "./model/live-activity-props";

/**
 * The Lock Screen and Dynamic Island views. The `widget` directive turns this function into a string
 * that the widget extension runs by itself: it can read only its arguments and the `@expo/ui`
 * SwiftUI components and modifiers, so every value it needs is declared inside it.
 */
function agentLiveActivityLayout(
  props: AgentLiveActivityProps,
  environment: LiveActivityEnvironment,
): LiveActivityLayout {
  "widget";
  // The app cannot update the activity while iOS suspends it, so old content does not claim a state.
  const stale = environment.isStale === true;
  const tint = stale ? "#8E8E93" : props.tint;
  const label = stale ? "Not current" : props.label;
  const detail = stale ? "Open OpenBot to see the current state." : props.detail;
  const secondary = { type: "hierarchical", style: "secondary" } as const;
  const rows = stale ? [] : props.rows;
  // Old answers can target a request that is gone. The app checks again, but the view offers none.
  const buttons = stale ? [] : props.buttons;
  const photo = (uri: string, size: number, key?: string) =>
    uri ? (
      <Image
        key={key}
        uiImage={uri}
        modifiers={[resizable(), frame({ width: size, height: size }), clipShape("circle")]}
      />
    ) : (
      <Image key={key} systemName={props.symbol} color={tint} size={size * 0.7} />
    );
  const avatar = (size: number) => photo(props.avatar, size);
  // Several agents with unread replies: overlapping photos, and a row for each chat.
  const agents = stale ? [] : props.agents;
  const photos = (size: number) => (
    <HStack spacing={-size * 0.3}>{agents.slice(0, 3).map((agent) => photo(agent.avatar, size, agent.url))}</HStack>
  );
  // A Live Activity cannot scroll, and each view has a fixed maximum height. So a view shows `lines`
  // lines at most, and when agents do not fit, the last line opens the chat list for the others.
  const agentList = (lines: number, size: number) => {
    const shown = props.agentCount > lines ? lines - 1 : lines;
    return (
      <VStack alignment="leading" spacing={size > 24 ? 6 : 4}>
        {agents.slice(0, shown).map((agent) => (
          <Link key={agent.url} destination={agent.url}>
            <HStack spacing={10}>
              {photo(agent.avatar, size)}
              <Text modifiers={[font({ size: 15, weight: "semibold" }), lineLimit(1)]}>{agent.name}</Text>
              <Spacer />
              {/* A plain count, as a list row shows it. A shape here reads as a second button in the row. */}
              <Text modifiers={[font({ size: 15, weight: "medium" }), foregroundStyle(secondary)]}>
                {String(agent.count)}
              </Text>
              <Image systemName="chevron.right" color="#8E8E93" size={12} />
            </HStack>
          </Link>
        ))}
        {props.agentCount > shown ? (
          <Link destination={props.listUrl}>
            <HStack>
              <Text modifiers={[font({ size: 14, weight: "medium" }), foregroundStyle(secondary)]}>
                {`+${props.agentCount - shown} more`}
              </Text>
              <Spacer />
            </HStack>
          </Link>
        ) : null}
      </VStack>
    );
  };
  const status = (
    <HStack spacing={5}>
      <Image systemName={props.symbol} color={tint} size={13} />
      <Text modifiers={[font({ size: 14, weight: "semibold" }), foregroundStyle(tint), lineLimit(1)]}>{label}</Text>
    </HStack>
  );
  const text = (
    <VStack alignment="leading" spacing={3}>
      {rows.length > 1 ? (
        rows.map((row) => (
          <HStack key={row.name} spacing={6}>
            <Text modifiers={[font({ size: 15, weight: "semibold" }), lineLimit(1)]}>{row.name}</Text>
            <Text modifiers={[font({ size: 15 }), foregroundStyle(secondary), lineLimit(1), privacySensitive()]}>
              {row.text}
            </Text>
          </HStack>
        ))
      ) : (
        <VStack alignment="leading" spacing={2}>
          <Text modifiers={[font({ size: 16, weight: "semibold" }), lineLimit(1), privacySensitive()]}>
            {props.title}
          </Text>
          <Text
            modifiers={[
              font({ size: 14 }),
              foregroundStyle(secondary),
              lineLimit(props.detailLines),
              privacySensitive(),
            ]}
          >
            {detail}
          </Text>
        </VStack>
      )}
    </VStack>
  );
  const footer =
    props.footer && !stale ? (
      <Text modifiers={[font({ size: 13 }), foregroundStyle(secondary), lineLimit(1)]}>{props.footer}</Text>
    ) : null;
  const actions =
    buttons.length > 0 ? (
      <HStack spacing={8}>
        {buttons.map((button) => (
          <Link key={button.url} destination={button.url}>
            <Text
              modifiers={[
                font({ size: 14, weight: "semibold" }),
                foregroundStyle(button.prominent ? { type: "hierarchical", style: "primary" } : secondary),
                lineLimit(1),
                padding({ horizontal: 14, vertical: 7 }),
                // Neutral buttons: the state color is for the label, not for the answers.
                background(button.prominent ? "#7878805C" : "#7878803D"),
                clipShape("capsule"),
              ]}
            >
              {button.label}
            </Text>
          </Link>
        ))}
        <Spacer />
      </HStack>
    ) : null;
  return {
    // Lock Screen: the state heads the view, and below it the photo and text read as a message from
    // the agent. The photo lines up with the name, not with the state line.
    banner: (
      <VStack alignment="leading" spacing={10} modifiers={[padding({ horizontal: 16, vertical: 14 })]}>
        <HStack>
          {status}
          <Spacer />
          <Text modifiers={[font({ size: 13, weight: "medium" }), foregroundStyle(secondary)]}>OpenBot</Text>
        </HStack>
        {agents.length > 0 ? (
          agentList(3, 26)
        ) : (
          <HStack alignment="top" spacing={12}>
            {avatar(44)}
            <VStack alignment="leading" spacing={4}>
              {text}
              {footer}
            </VStack>
            <Spacer />
          </HStack>
        )}
        {actions}
      </VStack>
    ),
    // The compact regions sit against the sides of the island. The padding keeps both off its rounded ends.
    compactLeading: (
      <HStack modifiers={[padding({ leading: 6 })]}>{agents.length > 0 ? photos(20) : avatar(22)}</HStack>
    ),
    compactTrailing: (
      <Text
        modifiers={[
          font({ size: 15, weight: "semibold" }),
          foregroundStyle(tint),
          lineLimit(1),
          padding({ trailing: 6 }),
        ]}
      >
        {stale ? "…" : props.compact}
      </Text>
    ),
    // The minimal view is one small circle, so it keeps one photo.
    minimal: avatar(22),
    // Expanded island: the state and its count sit beside the camera. Below, the photo and text read
    // as a notification from the agent, and the answers use the full width.
    expandedLeading: <HStack modifiers={[padding({ leading: 8, top: 6 })]}>{status}</HStack>,
    expandedTrailing: <HStack modifiers={[padding({ trailing: 8, top: 6 })]}>{footer}</HStack>,
    expandedBottom: (
      <VStack alignment="leading" spacing={12} modifiers={[padding({ horizontal: 8, top: 6, bottom: 8 })]}>
        {agents.length > 0 ? (
          agentList(3, 22)
        ) : (
          <HStack alignment="top" spacing={12}>
            {avatar(44)}
            {text}
            <Spacer />
          </HStack>
        )}
        {actions}
      </VStack>
    ),
  };
}

const AVATAR_PREFIX = "avatar-";
/** Three pixels for each point of the largest view, the 44-point expanded island. */
const BLOUB_PIXELS = 132;
const AVATAR_EXTENSIONS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

let native: AgentLiveActivityNative | undefined;

/** Registers the layout once, when the workspace starts. */
export const agentLiveActivity: AgentLiveActivityLoader = () => {
  native ??= {
    starter: createLiveActivity<AgentLiveActivityProps>("AgentActivity", agentLiveActivityLayout),
    saveAvatar(name, dataUrl) {
      const match = /^data:([a-z/]+);base64,(.+)$/u.exec(dataUrl);
      const extension = match?.[1] ? AVATAR_EXTENSIONS[match[1]] : undefined;
      // The App Group is missing when the widget extension was not built into the app.
      if (!widgetsDirectory || !match?.[2] || !extension) return null;
      const file = new File(widgetsDirectory, `${AVATAR_PREFIX}${name}.${extension}`);
      if (!file.exists) file.write(match[2], { encoding: "base64" });
      return file.uri;
    },
    renderBloub: (seed, hue, mood) => renderBloubAvatar(seed, hue, mood, BLOUB_PIXELS),
    removeAvatars(keep) {
      if (!widgetsDirectory) return;
      for (const entry of new Directory(widgetsDirectory).list()) {
        const name = entry.name.replace(/\.[a-z]+$/u, "").slice(AVATAR_PREFIX.length);
        if (entry instanceof File && entry.name.startsWith(AVATAR_PREFIX) && !keep.has(name)) entry.delete();
      }
    },
  };
  return native;
};
