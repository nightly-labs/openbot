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
  widgetURL,
} from "@expo/ui/swift-ui/modifiers";
import type { AgentLiveActivityProps } from "@openbot/team-client/live-activity-props";
import { Directory, File } from "expo-file-system";
import {
  LiveActivity,
  type LiveActivityEnvironment,
  type LiveActivityLayout,
  type PushTokenEvent,
  widgetsDirectory,
} from "expo-widgets";
import ExpoWidgetsModule from "expo-widgets/build/ExpoWidgets";
import type { AgentLiveActivityLoader, AgentLiveActivityNative } from "./agent-live-activity.types";
import { renderBloubAvatar } from "./model/live-activity-bloub";
import { openSealedLiveActivity } from "./model/live-activity-open";
import type { LiveActivityInstance } from "./model/live-activity-sync";

/** The props of the layout: the activity props, and the App Group folder that has the pictures. */
type AgentLiveActivityLayoutProps = AgentLiveActivityProps & { dir: string };

/**
 * The Lock Screen and Dynamic Island views. The `widget` directive turns this function into a string
 * that the widget extension runs by itself: it can read only its arguments and the `@expo/ui`
 * SwiftUI components and modifiers, so every value it needs is declared inside it.
 */
function agentLiveActivityLayout(
  props: AgentLiveActivityLayoutProps,
  environment: LiveActivityEnvironment,
): LiveActivityLayout {
  "widget";
  // The app cannot update the activity while iOS suspends it, so old content does not claim a state.
  const stale = environment.isStale === true;
  const tint = stale ? "#8E8E93" : props.tint;
  // One agent's state takes the agent color, and several agents are white. The island is always
  // black. The Lock Screen banner is light in the light appearance, so white is dark there. An
  // older host sends no `compactTint`.
  const islandTint = stale ? tint : (props.compactTint ?? tint);
  const bannerTint = islandTint === "#FFFFFF" && environment.colorScheme === "light" ? "#1C1C1E" : islandTint;
  const label = stale ? props.staleLabel : props.label;
  const detail = stale ? props.staleDetail : props.detail;
  const secondary = { type: "hierarchical", style: "secondary" } as const;
  const rows = stale ? [] : props.rows;
  // Old answers can target a request that is gone. The app checks again, but the view offers none.
  const buttons = stale ? [] : props.buttons;
  // The props name a picture file, and the App Group folder is the same for all of them.
  const photo = (file: string, size: number, key?: string) =>
    file ? (
      <Image
        key={key}
        uiImage={props.dir + file}
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
    // The app sends the last line only when not all agents fit.
    const shown = props.moreLabel ? lines - 1 : lines;
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
        {props.moreLabel ? (
          <Link destination={props.listUrl}>
            <HStack>
              <Text modifiers={[font({ size: 14, weight: "medium" }), foregroundStyle(secondary)]}>
                {props.moreLabel}
              </Text>
              <Spacer />
            </HStack>
          </Link>
        ) : null}
      </VStack>
    );
  };
  const status = (color: string) => (
    <HStack spacing={5}>
      <Image systemName={props.symbol} color={color} size={13} />
      <Text modifiers={[font({ size: 14, weight: "semibold" }), foregroundStyle(color), lineLimit(1)]}>{label}</Text>
    </HStack>
  );
  const text = (
    <VStack alignment="leading" spacing={3}>
      {rows.length > 1 ? (
        rows.map((row) => (
          <HStack key={row.name} spacing={6}>
            <Text modifiers={[font({ size: 15, weight: "semibold" }), lineLimit(1)]}>{row.name}</Text>
            <Text
              markdownEnabled
              modifiers={[font({ size: 15 }), foregroundStyle(secondary), lineLimit(1), privacySensitive()]}
            >
              {row.text}
            </Text>
          </HStack>
        ))
      ) : (
        <VStack alignment="leading" spacing={2}>
          <Text modifiers={[font({ size: 16, weight: "semibold" }), lineLimit(1), privacySensitive()]}>
            {props.title}
          </Text>
          {/* Replies and questions come as inline Markdown. A command or an error shows as written. */}
          <Text
            markdownEnabled={!stale && props.detailMarkdown === true}
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
    // Each presentation has one tap link: iOS fixes the activity URL when it starts, so the link
    // comes from the props, and it follows the state.
    banner: (
      <VStack
        alignment="leading"
        spacing={10}
        modifiers={[padding({ horizontal: 16, vertical: 14 }), widgetURL(props.tapUrl)]}
      >
        <HStack>
          {status(bannerTint)}
          <Spacer />
          <Text modifiers={[font({ size: 13, weight: "medium" }), foregroundStyle(secondary)]}>{props.appName}</Text>
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
      <HStack modifiers={[padding({ leading: 6 }), widgetURL(props.tapUrl)]}>
        {agents.length > 0 ? photos(20) : avatar(22)}
      </HStack>
    ),
    compactTrailing: (
      <Text
        modifiers={[
          font({ size: 15, weight: "semibold" }),
          foregroundStyle(islandTint),
          lineLimit(1),
          padding({ trailing: 6 }),
        ]}
      >
        {stale ? "…" : props.compact}
      </Text>
    ),
    // The minimal view is one small circle, so it keeps one photo.
    minimal: <HStack modifiers={[widgetURL(props.tapUrl)]}>{avatar(22)}</HStack>,
    // Expanded island: the state and its count sit beside the camera. Below, the photo and text read
    // as a notification from the agent, and the answers use the full width.
    expandedLeading: <HStack modifiers={[padding({ leading: 8, top: 6 })]}>{status(islandTint)}</HStack>,
    expandedTrailing: <HStack modifiers={[padding({ trailing: 8, top: 6 })]}>{footer}</HStack>,
    expandedBottom: (
      <VStack
        alignment="leading"
        spacing={12}
        modifiers={[padding({ horizontal: 8, top: 6, bottom: 8 }), widgetURL(props.tapUrl)]}
      >
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

const ACTIVITY_NAME = "AgentActivity";
const AVATAR_PREFIX = "avatar-";
/** Three pixels for each point of the largest view, the 44-point expanded island. */
const BLOUB_PIXELS = 132;
const AVATAR_EXTENSIONS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

/**
 * The layout the widget extension runs. A host update comes as `{ sealed }`, which only the keys in
 * this text open, so the layout has the keys. The extension reads the layout from the App Group,
 * which only this app and its extension can read.
 */
function composeLayout(constants: {
  dir: string;
  seal: string;
  tag: string;
  fallback: AgentLiveActivityProps | null;
}): string {
  return `(function () {
  var c = ${JSON.stringify(constants)};
  var open = ${String(openSealedLiveActivity)};
  var layout = ${String(agentLiveActivityLayout)};
  return function (props, environment) {
    var shown = props;
    var context = environment;
    if (typeof props.sealed === "string") {
      var text = c.seal ? open(props.sealed, c.seal, c.tag) : null;
      var opened = null;
      try { opened = text === null ? null : JSON.parse(text); } catch (error) { opened = null; }
      shown = opened || c.fallback || {};
      if (!opened) context = Object.assign({}, environment, { isStale: true });
    }
    return layout(Object.assign({}, shown, { dir: c.dir }), context);
  };
})()`;
}

function toInstance(activity: LiveActivity): LiveActivityInstance<AgentLiveActivityProps> {
  return {
    update: (props, staleDate) => activity.update(props, staleDate),
    end: (dismissalPolicy) => activity.end(dismissalPolicy),
    watchPushToken(receive) {
      let stopped = false;
      const subscription = activity.addPushTokenListener((event: PushTokenEvent) => receive(event.pushToken));
      void activity.getPushToken().then(
        (token) => {
          if (!stopped && token) receive(token);
        },
        // Without push notifications the activity has no token, and only the app updates it.
        () => undefined,
      );
      return () => {
        stopped = true;
        subscription.remove();
      };
    },
  };
}

let native: AgentLiveActivityNative | undefined;

/** Registers the layout once, when the workspace starts, and again when its keys change. */
export const agentLiveActivity: AgentLiveActivityLoader = () => {
  if (native) return native;
  const dir = widgetsDirectory ?? "";
  let factory = new ExpoWidgetsModule.LiveActivityFactory(
    ACTIVITY_NAME,
    composeLayout({ dir, seal: "", tag: "", fallback: null }),
  );
  let layoutKeys = "";
  native = {
    starter: {
      start: (props, staleDate) =>
        toInstance(new LiveActivity(factory.start(JSON.stringify(props), undefined, staleDate?.getTime()))),
      getInstances: () => factory.getInstances().map((activity) => toInstance(new LiveActivity(activity))),
    },
    setSealKeys(keys, fallback) {
      const next = JSON.stringify([keys, fallback]);
      if (next === layoutKeys) return;
      layoutKeys = next;
      factory = new ExpoWidgetsModule.LiveActivityFactory(
        ACTIVITY_NAME,
        composeLayout({ dir, seal: keys?.seal ?? "", tag: keys?.tag ?? "", fallback }),
      );
    },
    saveAvatar(name, dataUrl) {
      const match = /^data:([a-z/]+);base64,(.+)$/u.exec(dataUrl);
      const extension = match?.[1] ? AVATAR_EXTENSIONS[match[1]] : undefined;
      // The App Group is missing when the widget extension was not built into the app.
      if (!widgetsDirectory || !match?.[2] || !extension) return null;
      const fileName = `${AVATAR_PREFIX}${name}.${extension}`;
      const file = new File(widgetsDirectory, fileName);
      if (!file.exists) file.write(match[2], { encoding: "base64" });
      return fileName;
    },
    hasAvatar: (fileName) => Boolean(widgetsDirectory) && new File(widgetsDirectory, fileName).exists,
    renderBloub: (seed, hue, mood) => renderBloubAvatar(seed, hue, mood, BLOUB_PIXELS),
    removeAvatars(keep) {
      if (!widgetsDirectory) return;
      for (const entry of new Directory(widgetsDirectory).list()) {
        if (entry instanceof File && entry.name.startsWith(AVATAR_PREFIX) && !keep.has(entry.name)) entry.delete();
      }
    },
  };
  return native;
};
