import { HStack, Image, Link, Spacer, Text, VStack, ZStack } from "@expo/ui/swift-ui";
import {
  background,
  buttonStyle,
  clipShape,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  padding,
  privacySensitive,
  resizable,
  shapes,
  widgetURL,
} from "@expo/ui/swift-ui/modifiers";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import type { AgentLiveActivityProps } from "@openbot/team-client/live-activity-props";
import { FilterMode, ImageFormat, MipmapMode, Skia } from "@shopify/react-native-skia";
import { Directory, File, Paths } from "expo-file-system";
import {
  LiveActivity,
  type LiveActivityEnvironment,
  type LiveActivityLayout,
  type PushTokenEvent,
  widgetsDirectory,
} from "expo-widgets";
import ExpoWidgetsModule from "expo-widgets/build/ExpoWidgets";
import type { ReactElement } from "react";
import { PLUSH_STYLE, renderPlushPicture } from "@/features/agents/model/plush/plush-picture";
import type { AgentLiveActivityLoader, AgentLiveActivityNative } from "./agent-live-activity.types";
import { openSealedLiveActivity } from "./model/live-activity-open";
import type { LiveActivityInstance } from "./model/live-activity-sync";

type AgentLiveActivityLayoutProps = AgentLiveActivityProps & { dir: string };

function agentLiveActivityLayout(
  props: AgentLiveActivityLayoutProps,
  environment: LiveActivityEnvironment,
): LiveActivityLayout {
  "widget";
  const stale = environment.isStale === true;
  const tint = stale ? "#8E8E93" : props.tint;
  const islandTint = stale ? tint : (props.compactTint ?? tint);
  const bannerTint = islandTint === "#FFFFFF" && environment.colorScheme === "light" ? "#1C1C1E" : islandTint;
  const label = stale ? props.staleLabel : props.label;
  const detail = stale ? props.staleDetail : props.detail;
  const secondary = { type: "hierarchical", style: "secondary" } as const;
  const rows = stale ? [] : props.rows;
  const buttons = stale ? [] : props.buttons;
  const photo = (file: string, size: number, key?: string) =>
    file ? (
      <Image
        key={key}
        uiImage={props.dir + file}
        modifiers={
          file.indexOf("avatar-bloub-") === 0
            ? [resizable(), frame({ width: size, height: size })]
            : [resizable(), frame({ width: size, height: size }), clipShape("circle")]
        }
      />
    ) : (
      <Image key={key} systemName={props.symbol} color={tint} size={size * 0.7} />
    );
  const avatar = (size: number) => photo(props.avatar, size);
  const waitSymbol =
    props.mode === "question"
      ? "questionmark"
      : props.mode === "approval"
        ? "checkmark.shield.fill"
        : props.mode === "takeover"
          ? "cursorarrow"
          : "";
  const islandAvatar = (size: number) =>
    waitSymbol && !stale ? (
      <ZStack alignment="bottomTrailing" modifiers={[frame({ width: size + 4, height: size + 3 })]}>
        <HStack modifiers={[frame({ width: size + 4, height: size + 3, alignment: "topLeading" })]}>
          {avatar(size)}
        </HStack>
        <Image
          systemName={waitSymbol}
          color="#000000"
          size={5.5}
          modifiers={[
            frame({ width: 9, height: 9 }),
            background("#FF9F0A", shapes.circle()),
            padding({ all: 1.5 }),
            background("#000000", shapes.circle()),
          ]}
        />
      </ZStack>
    ) : (
      avatar(size)
    );
  const agents = stale ? [] : props.agents;
  const photos = (size: number) => (
    <HStack spacing={-size * 0.3}>{agents.slice(0, 3).map((agent) => photo(agent.avatar, size, agent.url))}</HStack>
  );
  const agentList = (lines: number, size: number) => {
    const shown = props.moreLabel ? lines - 1 : lines;
    return (
      <VStack alignment="leading" spacing={size > 24 ? 6 : 4}>
        {agents.slice(0, shown).map((agent) => (
          <Link key={agent.url} destination={agent.url}>
            <HStack spacing={10}>
              {photo(agent.avatar, size)}
              <Text modifiers={[font({ size: 15, weight: "semibold" }), lineLimit(1)]}>{agent.name}</Text>
              <Spacer />
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
  const actions = (island: boolean) =>
    buttons.length > 0 ? (
      <HStack spacing={8}>
        {buttons.map((button) => {
          const solid = island && button.prominent;
          return (
            <Link key={button.url} destination={button.url} modifiers={[buttonStyle("plain")]}>
              <HStack
                modifiers={[
                  frame({ maxWidth: 10_000 }),
                  padding({ horizontal: 10, vertical: 8 }),
                  background(solid ? "#FFFFFF" : button.prominent ? "#7878805C" : "#7878803D", shapes.capsule()),
                ]}
              >
                <Text
                  modifiers={[
                    font({ size: 15, weight: "semibold" }),
                    foregroundStyle(solid ? "#000000" : { type: "hierarchical", style: "primary" }),
                    lineLimit(1),
                  ]}
                >
                  {button.label}
                </Text>
              </HStack>
            </Link>
          );
        })}
      </HStack>
    ) : null;
  const tapLink = (key: string, content: ReactElement) => (
    <Link key={key} destination={props.tapUrl} modifiers={[buttonStyle("plain")]}>
      {content}
    </Link>
  );
  return {
    banner: (
      <VStack
        alignment="leading"
        spacing={10}
        modifiers={[padding({ horizontal: 16, vertical: 14 }), widgetURL(props.tapUrl)]}
      >
        <HStack>
          {status(waitSymbol ? tint : bannerTint)}
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
        {actions(false)}
      </VStack>
    ),
    bannerSmall: (
      <VStack
        alignment="leading"
        spacing={6}
        modifiers={[padding({ horizontal: 12, vertical: 10 }), widgetURL(props.tapUrl)]}
      >
        <HStack>
          {status(waitSymbol ? tint : islandTint)}
          <Spacer />
          <Text modifiers={[font({ size: 12, weight: "medium" }), foregroundStyle(secondary)]}>{props.appName}</Text>
        </HStack>
        {agents.length > 0 ? (
          agentList(2, 22)
        ) : (
          <HStack alignment="top" spacing={10}>
            {avatar(40)}
            <VStack alignment="leading" spacing={1}>
              <Text modifiers={[font({ size: 15, weight: "semibold" }), lineLimit(1), privacySensitive()]}>
                {props.title}
              </Text>
              <Text
                markdownEnabled={!stale && props.detailMarkdown === true}
                modifiers={[font({ size: 13 }), foregroundStyle(secondary), lineLimit(2), privacySensitive()]}
              >
                {detail}
              </Text>
              {props.footer && !stale ? (
                <Text modifiers={[font({ size: 12 }), foregroundStyle(secondary), lineLimit(1)]}>{props.footer}</Text>
              ) : null}
            </VStack>
            <Spacer />
          </HStack>
        )}
      </VStack>
    ),
    compactLeading: (
      <HStack modifiers={[padding({ leading: 6 }), widgetURL(props.tapUrl)]}>
        {agents.length > 0 ? photos(20) : islandAvatar(22)}
      </HStack>
    ),
    compactTrailing: (
      <HStack modifiers={[padding({ trailing: 6 })]}>
        <Text modifiers={[font({ size: 15, weight: "semibold" }), foregroundStyle(islandTint), lineLimit(1)]}>
          {stale ? "…" : props.compact}
        </Text>
      </HStack>
    ),
    minimal: <HStack modifiers={[widgetURL(props.tapUrl)]}>{islandAvatar(22)}</HStack>,
    expandedLeading: (
      <HStack modifiers={[padding({ leading: 8, top: 6 })]}>
        {tapLink("state", status(waitSymbol ? tint : islandTint))}
      </HStack>
    ),
    expandedTrailing: (
      <HStack modifiers={[padding({ trailing: 8, top: 6 })]}>{footer ? tapLink("count", footer) : null}</HStack>
    ),
    expandedBottom: (
      <VStack
        alignment="leading"
        spacing={12}
        modifiers={[padding({ horizontal: 8, top: 6, bottom: 8 }), widgetURL(props.tapUrl)]}
      >
        {agents.length > 0
          ? agentList(3, 22)
          : tapLink(
              "content",
              <HStack alignment="top" spacing={12}>
                {avatar(44)}
                {text}
                <Spacer />
              </HStack>,
            )}
        {actions(true)}
      </VStack>
    ),
  };
}

const ACTIVITY_NAME = "AgentActivity";
const AVATAR_PREFIX = "avatar-";
const AVATAR_PIXELS = 132;
const AVATAR_EXTENSIONS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const STYLE_FILE = "plush-style.txt";

function fittedAvatar(data: string, extension: string): { data: string; extension: string } | null {
  const image = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBase64(data));
  if (!image) return null;
  const side = Math.min(image.width(), image.height());
  if (image.width() === image.height() && side <= AVATAR_PIXELS) return { data, extension };
  const pixels = Math.min(side, AVATAR_PIXELS);
  const surface = Skia.Surface.Make(pixels, pixels);
  if (!surface) return null;
  const paint = Skia.Paint();
  paint.setAntiAlias(true);
  surface
    .getCanvas()
    .drawImageRectOptions(
      image,
      Skia.XYWHRect((image.width() - side) / 2, (image.height() - side) / 2, side, side),
      Skia.XYWHRect(0, 0, pixels, pixels),
      FilterMode.Linear,
      MipmapMode.Linear,
      paint,
    );
  surface.flush();
  return { data: surface.makeImageSnapshot().encodeToBase64(ImageFormat.PNG), extension: "png" };
}

function removeOldAvatars(directory: string): void {
  try {
    const style = new File(directory, STYLE_FILE);
    if (style.exists && style.textSync() === PLUSH_STYLE) return;
    for (const entry of new Directory(directory).list()) {
      if (entry instanceof File && entry.name.startsWith(AVATAR_PREFIX)) entry.delete();
    }
    style.writeSync(PLUSH_STYLE);
  } catch {}
}

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
    var shown = props || {};
    var context = environment;
    if (props && typeof props.sealed === "string") {
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

const START_FILE = "live-activity-start.json";

function rememberStart(id: string, startedAt: number): void {
  try {
    new File(Paths.document, START_FILE).writeSync(JSON.stringify({ id, startedAt }));
  } catch {}
}

function savedStart(id: string): number | null {
  try {
    const file = new File(Paths.document, START_FILE);
    if (!file.exists) return null;
    const saved = JSON.parse(file.textSync());
    return isDynamicRecord(saved) && saved.id === id && typeof saved.startedAt === "number" ? saved.startedAt : null;
  } catch {
    return null;
  }
}

function toInstance(
  activity: LiveActivity,
  startedAt: number | null,
  activeIds: () => ReadonlySet<string> | null,
): LiveActivityInstance<AgentLiveActivityProps> {
  return {
    startedAt,
    isActive: () => activeIds()?.has(activity.getId()) ?? true,
    update: (props, staleDate) => activity.update(props, staleDate),
    end: (dismissalPolicy) => activity.end(dismissalPolicy),
    watchPushToken(receive) {
      let stopped = false;
      const subscription = activity.addPushTokenListener((event: PushTokenEvent) => receive(event.pushToken));
      void activity.getPushToken().then(
        (token) => {
          if (!stopped && token) receive(token);
        },
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

export const agentLiveActivity: AgentLiveActivityLoader = () => {
  if (native) return native;
  const dir = widgetsDirectory ?? "";
  if (widgetsDirectory) removeOldAvatars(widgetsDirectory);
  let factory = new ExpoWidgetsModule.LiveActivityFactory(
    ACTIVITY_NAME,
    composeLayout({ dir, seal: "", tag: "", fallback: null }),
  );
  let layoutKeys = "";
  const activeIds = (): ReadonlySet<string> | null => {
    try {
      return new Set(factory.getInstances().map((instance) => instance.getId()));
    } catch {
      return null;
    }
  };
  native = {
    starter: {
      start: (props, staleDate) => {
        const activity = new LiveActivity(factory.start(JSON.stringify(props), undefined, staleDate?.getTime()));
        const startedAt = Date.now();
        rememberStart(activity.getId(), startedAt);
        return toInstance(activity, startedAt, activeIds);
      },
      getInstances: () =>
        factory.getInstances().map((native) => {
          const activity = new LiveActivity(native);
          return toInstance(activity, savedStart(activity.getId()), activeIds);
        }),
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
      if (!widgetsDirectory || !match?.[2] || !extension) return null;
      const picture = fittedAvatar(match[2], extension);
      if (!picture) return null;
      const fileName = `${AVATAR_PREFIX}${name}.${picture.extension}`;
      const file = new File(widgetsDirectory, fileName);
      if (!file.exists) file.writeSync(picture.data, { encoding: "base64" });
      return fileName;
    },
    hasAvatar: (fileName) => Boolean(widgetsDirectory) && new File(widgetsDirectory, fileName).exists,
    renderBloub: async (seed, hue, mood, color) =>
      `data:image/png;base64,${await renderPlushPicture({ seed, hue, color, mood, pixels: AVATAR_PIXELS, saturation: 1 })}`,
    removeAvatars(keep) {
      if (!widgetsDirectory) return;
      for (const entry of new Directory(widgetsDirectory).list()) {
        if (entry instanceof File && entry.name.startsWith(AVATAR_PREFIX) && !keep.has(entry.name)) entry.delete();
      }
    },
  };
  return native;
};
