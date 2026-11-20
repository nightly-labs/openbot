import type { AppFormat } from "@openbot/i18n/mobile";
import { Typography } from "heroui-native";
import { useEffect, useRef } from "react";
import { Alert } from "react-native";
import { useUniwind } from "uniwind";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { SettingsSwitch } from "@/features/settings/components/settings-controls";
import { haptics } from "@/shared/lib/haptics";
import { type MobileText, useText } from "@/shared/lib/text";

export type ImportCountKind = "agent" | "channel" | "skill" | "routine" | "memory" | "file";

export function importCount(t: MobileText["t"], kind: ImportCountKind, count: number): string {
  switch (kind) {
    case "agent":
      return t("mobile.server.import.count.agent", { count });
    case "channel":
      return t("mobile.server.import.count.channel", { count });
    case "skill":
      return t("mobile.server.import.count.skill", { count });
    case "routine":
      return t("mobile.server.import.count.routine", { count });
    case "memory":
      return t("mobile.server.import.count.memory", { count });
    case "file":
      return t("mobile.server.import.count.file", { count });
  }
}

export function agentContents(
  t: MobileText["t"],
  agent: { skillCount: number; routineCount: number; memoryCount: number; fileCount: number },
): string {
  const parts = [
    importCount(t, "skill", agent.skillCount),
    importCount(t, "routine", agent.routineCount),
    importCount(t, "memory", agent.memoryCount),
  ];
  if (agent.fileCount > 0) parts.push(importCount(t, "file", agent.fileCount));
  return parts.join(" · ");
}

export function transferContents(
  t: MobileText["t"],
  format: AppFormat,
  agents: readonly { skillCount: number; routineCount: number; memoryCount: number }[],
  fileBytes: number,
  settings: boolean,
): string[] {
  const sum = (count: (agent: (typeof agents)[number]) => number) =>
    agents.reduce((total, agent) => total + count(agent), 0);
  return [
    importCount(t, "agent", agents.length),
    importCount(
      t,
      "skill",
      sum((agent) => agent.skillCount),
    ),
    importCount(
      t,
      "routine",
      sum((agent) => agent.routineCount),
    ),
    importCount(
      t,
      "memory",
      sum((agent) => agent.memoryCount),
    ),
    fileBytes > 0
      ? t("mobile.server.transfer.filesSize", { size: format.fileSize(fileBytes) })
      : t("mobile.server.transfer.noFiles"),
    settings ? t("mobile.server.transfer.settings") : t("mobile.server.transfer.noSettings"),
  ];
}

export function exportDate(value: string, format: AppFormat): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return format.date(date, { day: "numeric", month: "short", year: "numeric" });
}

export function useReleaseOnClose(
  token: string | null,
  discard: (token: string, serverId: string) => Promise<void>,
  serverId: string,
) {
  const open = useRef(token);
  open.current = token;
  const closed = useRef(false);
  useEffect(() => {
    closed.current = false;
    return () => {
      closed.current = true;
      if (open.current) void discard(open.current, serverId).catch(() => undefined);
    };
  }, [discard, serverId]);
  return closed;
}

export function confirmDuplicateNames(
  t: MobileText["t"],
  agents: readonly { name: string; nameExists: boolean }[],
  start: () => void,
): void {
  const duplicates = agents.filter((agent) => agent.nameExists);
  if (duplicates.length === 0) {
    start();
    return;
  }
  Alert.alert(
    t("mobile.server.import.duplicatesTitle"),
    t("mobile.server.import.duplicatesBody", { names: duplicates.map((agent) => agent.name).join(", ") }),
    [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("mobile.server.import.duplicatesConfirm"), onPress: start },
    ],
  );
}

export function toggledKeys(set: ReadonlySet<string>, key: string, include: boolean): ReadonlySet<string> {
  const next = new Set(set);
  if (include) next.delete(key);
  else next.add(key);
  return next;
}

export function IncludeRow({
  label,
  supportingText,
  value,
  disabled,
  onValueChange,
}: {
  label: string;
  supportingText?: string;
  value: boolean;
  disabled: boolean;
  onValueChange: (value: boolean) => void;
}) {
  const { theme } = useUniwind();
  return (
    <SettingsRow supportingText={supportingText}>
      <SettingsSwitch
        value={value}
        disabled={disabled}
        label={label}
        dark={theme === "dark"}
        onValueChange={(next) => {
          void haptics.selection();
          onValueChange(next);
        }}
      />
    </SettingsRow>
  );
}

export function NotesSection({ title, notes }: { title: string; notes: readonly string[] }) {
  const { sourceText } = useText();
  if (notes.length === 0) return null;
  return (
    <SettingsSection title={title}>
      {[...new Set(notes)].map((note) => (
        <SettingsRow key={note} disclosure={false}>
          <Typography.Paragraph type="body-sm">{sourceText(note)}</Typography.Paragraph>
        </SettingsRow>
      ))}
    </SettingsSection>
  );
}
