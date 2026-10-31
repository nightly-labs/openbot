import type { AppFormat } from "@openbot/i18n/mobile";
import { Typography } from "heroui-native";
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

/** The skills, routines, memories and files of one agent, on one line. */
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

/** The date an export was made. A value that is not a date shows as it is. */
export function exportDate(value: string, format: AppFormat): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return format.date(date, { day: "numeric", month: "short", year: "numeric" });
}

/** Adds or removes `key` from the keys that the user left out. */
export function toggledKeys(set: ReadonlySet<string>, key: string, include: boolean): ReadonlySet<string> {
  const next = new Set(set);
  if (include) next.delete(key);
  else next.add(key);
  return next;
}

/** One item that the user includes or leaves out, such as an agent of an export. */
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

/** Text that the host sent, such as the items an import leaves out. */
export function NotesSection({ title, notes }: { title: string; notes: readonly string[] }) {
  const { sourceText } = useText();
  if (notes.length === 0) return null;
  return (
    <SettingsSection title={title}>
      {/* The host can send the same text twice. It shows once. */}
      {[...new Set(notes)].map((note) => (
        <SettingsRow key={note} disclosure={false}>
          <Typography.Paragraph type="body-sm">{sourceText(note)}</Typography.Paragraph>
        </SettingsRow>
      ))}
    </SettingsSection>
  );
}
