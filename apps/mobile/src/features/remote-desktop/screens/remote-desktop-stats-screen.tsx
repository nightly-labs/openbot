import * as Clipboard from "expo-clipboard";
import { Stack } from "expo-router";
import { Typography } from "heroui-native";
import Check from "lucide-react-native/icons/check";
import Copy from "lucide-react-native/icons/copy";
import { useEffect, useState } from "react";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { AndroidHeaderButton } from "@/shared/components/android-header-button";
import { haptics } from "@/shared/lib/haptics";
import { isAndroid } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";
import {
  type RemoteDesktopStats,
  setRemoteDesktopStatsOpen,
  useRemoteDesktopStats,
} from "../model/remote-desktop-stats";

const COPIED_MS = 1_500;

/** The live connection stats of the open remote desktop, beside the stream. */
export function RemoteDesktopStatsScreen() {
  const { t, format } = useText();
  const stats = useRemoteDesktopStats();
  const [copied, setCopied] = useState(false);

  // The screen under the sheet asks the page for samples while the sheet is open.
  useEffect(() => {
    setRemoteDesktopStatsOpen(true);
    return () => setRemoteDesktopStatsOpen(false);
  }, []);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const none = t("mobile.server.remoteDesktop.stats.none");
  const ms = (value: number | null) =>
    value === null
      ? none
      : t("mobile.server.remoteDesktop.stats.ms", { value: format.number(value, { maximumFractionDigits: 1 }) });
  const count = (value: number | null) => (value === null ? none : format.number(value));
  const rows = (current: RemoteDesktopStats) =>
    [
      {
        section: "video",
        label: t("mobile.server.remoteDesktop.stats.resolution"),
        value:
          current.width !== null && current.height !== null
            ? t("mobile.server.remoteDesktop.stats.resolutionValue", {
                width: format.number(current.width),
                height: format.number(current.height),
              })
            : none,
      },
      { section: "video", label: t("mobile.server.remoteDesktop.stats.codec"), value: current.codec ?? none },
      {
        section: "video",
        label: t("mobile.server.remoteDesktop.stats.frameRate"),
        value:
          current.fps === null
            ? none
            : current.requestedFps === null
              ? t("mobile.server.remoteDesktop.stats.fps", { fps: format.number(current.fps) })
              : t("mobile.server.remoteDesktop.stats.fpsOf", {
                  fps: format.number(current.fps),
                  requested: format.number(current.requestedFps),
                }),
      },
      { section: "delay", label: t("mobile.server.remoteDesktop.stats.decode"), value: ms(current.decodeMs) },
      { section: "delay", label: t("mobile.server.remoteDesktop.stats.buffer"), value: ms(current.bufferMs) },
      { section: "delay", label: t("mobile.server.remoteDesktop.stats.host"), value: ms(current.hostMs) },
      { section: "delay", label: t("mobile.server.remoteDesktop.stats.streamer"), value: ms(current.streamerMs) },
      {
        section: "network",
        label: t("mobile.server.remoteDesktop.stats.packetsLost"),
        value: count(current.packetsLost),
      },
      {
        section: "network",
        label: t("mobile.server.remoteDesktop.stats.framesDropped"),
        value: count(current.framesDropped),
      },
      { section: "network", label: t("mobile.server.remoteDesktop.stats.nacks"), value: count(current.nacks) },
    ] as const;

  const copy = async () => {
    if (!stats) return;
    const report = `${rows(stats)
      .map((row) => `${row.label}: ${row.value}`)
      .join("\n")}\n\nMoonlight:\n${stats.raw}`;
    try {
      await Clipboard.setStringAsync(report);
      void haptics.notification("success");
      setCopied(true);
    } catch {
      void haptics.notification("error");
    }
  };
  const copyLabel = copied
    ? t("mobile.server.remoteDesktop.stats.copied")
    : t("mobile.server.remoteDesktop.stats.copy");

  const section = (name: "video" | "delay" | "network", title: string) =>
    stats ? (
      <SettingsSection title={title}>
        {rows(stats)
          .filter((row) => row.section === name)
          .map((row) => (
            <SettingsRow
              key={row.label}
              disclosure={false}
              trailing={
                <Typography.Paragraph className="shrink text-grouped-secondary" numberOfLines={1}>
                  {row.value}
                </Typography.Paragraph>
              }
            >
              <Typography.Paragraph>{row.label}</Typography.Paragraph>
            </SettingsRow>
          ))}
      </SettingsSection>
    ) : null;

  return (
    <>
      {isAndroid ? (
        <AndroidHeaderButton
          placement="right"
          icon={copied ? Check : Copy}
          disabled={!stats}
          accessibilityLabel={copyLabel}
          onPress={() => void copy()}
        />
      ) : (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button
            icon={copied ? "checkmark" : "doc.on.doc"}
            disabled={!stats}
            accessibilityLabel={copyLabel}
            onPress={() => void copy()}
          />
        </Stack.Toolbar>
      )}
      <SettingsContent>
        {stats ? null : <SettingsNote>{t("mobile.server.remoteDesktop.stats.waiting")}</SettingsNote>}
        {section("video", t("mobile.server.remoteDesktop.stats.video"))}
        {section("delay", t("mobile.server.remoteDesktop.stats.delay"))}
        {section("network", t("mobile.server.remoteDesktop.stats.network"))}
      </SettingsContent>
    </>
  );
}
