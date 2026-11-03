import type { AgentAccessLevel, ServerAuditChange, ServerAuditEntry } from "@openbot/contracts/ipc";
import { Stack, useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import Crown from "lucide-react-native/icons/crown";
import KeyRound from "lucide-react-native/icons/key-round";
import LogOut from "lucide-react-native/icons/log-out";
import Pencil from "lucide-react-native/icons/pencil";
import ShieldCheck from "lucide-react-native/icons/shield-check";
import Trash from "lucide-react-native/icons/trash";
import UserRoundPlus from "lucide-react-native/icons/user-round-plus";
import { useMemo, useState } from "react";
import { View } from "react-native";
import { useCSSVariable, useUniwind } from "uniwind";
import { BloubAvatar } from "@/features/agents/components/bloub-avatar";
import {
  AUDIT_FILTER_KEYS,
  AUDIT_FILTERS,
  type AuditFilter,
  type AuditPart,
  auditActor,
  auditCategory,
  auditLine,
  auditLineText,
  useServerAudit,
} from "@/features/servers/model/use-server-audit";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { SettingsPicker } from "@/features/settings/components/settings-controls";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import { isAndroid } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";

type Tone = "success" | "danger" | "accent";

/** The icon and its tone for one change, as on desktop: green adds, red takes away, blue changes. */
function changeMark(change: ServerAuditChange): { Icon: typeof Crown; tone: Tone } {
  switch (change.kind) {
    case "member-joined":
      return { Icon: UserRoundPlus, tone: "success" };
    case "role-member":
      return change.added ? { Icon: UserRoundPlus, tone: "success" } : { Icon: LogOut, tone: "danger" };
    case "member-removed":
      return { Icon: LogOut, tone: "danger" };
    case "member-role":
      return { Icon: Crown, tone: change.to === "admin" ? "success" : "danger" };
    case "role-created":
      return { Icon: ShieldCheck, tone: "success" };
    case "role-renamed":
      return { Icon: Pencil, tone: "accent" };
    case "role-deleted":
      return { Icon: Trash, tone: "danger" };
    case "agent-level":
      return { Icon: KeyRound, tone: "accent" };
  }
}

/** Less access is red, chat is green and full control is orange, as on desktop. */
const LEVEL_CLASS = {
  none: "text-danger-text",
  view: "text-foreground",
  chat: "text-success-text",
  manage: "text-warning-text",
} as const satisfies Record<AgentAccessLevel, string>;

function ChangeMark({ change }: { change: ServerAuditChange }) {
  const colors = {
    success: [useCSSVariable("--openbot-success-text"), useCSSVariable("--openbot-success-soft")],
    danger: [useCSSVariable("--openbot-danger-text"), useCSSVariable("--openbot-danger-soft")],
    accent: [useCSSVariable("--openbot-accent-text"), useCSSVariable("--openbot-accent-soft")],
  } as const;
  const { Icon, tone } = changeMark(change);
  const [color, background] = colors[tone];
  return (
    <View
      className="size-9 items-center justify-center rounded-full"
      style={{ backgroundColor: String(background) }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Icon color={String(color)} size={16} strokeWidth={2} />
    </View>
  );
}

function AuditLine({ parts }: { parts: readonly AuditPart[] }) {
  return (
    <Typography.Paragraph className="text-grouped-secondary">
      {parts.map((part) =>
        part.kind === "text" ? (
          part.text
        ) : part.kind === "to" ? (
          ` ${part.text} `
        ) : (
          <Typography
            key={part.id}
            weight="medium"
            className={part.level ? LEVEL_CLASS[part.level] : "text-foreground"}
          >
            {part.text}
          </Typography>
        ),
      )}
    </Typography.Paragraph>
  );
}

/**
 * Server sheet > Server settings > Audit log (`server-audit-v1`): the changes to the members, roles and
 * agent access of the server, newest first, with a filter by kind and a search. Owners and admins only.
 */
export function ServerAuditScreen() {
  const { t, format, errorMessage } = useText();
  const { theme } = useUniwind();
  const [foreground, muted] = useThemeColor(["foreground", "muted"]);
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const { available, log } = useServerAudit(serverId);
  const agents = useMobileWorkspaceSelector((workspace) => workspace.agents);
  const [filter, setFilter] = useState<AuditFilter>("all");
  const [search, setSearch] = useState("");
  const rows = useMemo(
    () =>
      (log.data?.entries ?? []).map((entry: ServerAuditEntry) => {
        const parts = auditLine(entry, t);
        return { entry, parts, line: auditLineText(parts), actor: auditActor(entry, t) };
      }),
    [log.data, t],
  );
  const shown = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return rows.filter((row) => {
      if (filter !== "all" && auditCategory(row.entry.change) !== filter) return false;
      return !query || [row.line, row.actor].some((value) => value.toLocaleLowerCase().includes(query));
    });
  }, [rows, filter, search]);

  if (!available)
    return (
      <SettingsContent>
        <SettingsNote>{t("mobile.server.audit.unavailable")}</SettingsNote>
      </SettingsContent>
    );
  if (!log.data)
    return (
      <SettingsContent>
        <SettingsNote>
          {log.isError
            ? errorMessage(log.error, t("mobile.server.audit.loadFailed"))
            : t("mobile.server.audit.loading")}
        </SettingsNote>
        {log.isError ? (
          <SettingsSection>
            <SettingsRow disclosure={false} disabled={log.isFetching} onPress={() => void log.refetch()}>
              <Typography.Paragraph className="text-accent">{t("mobile.server.members.retry")}</Typography.Paragraph>
            </SettingsRow>
          </SettingsSection>
        ) : null}
      </SettingsContent>
    );

  const agent = (agentId: string) => agents.find((item) => item.serverId === serverId && item.id === agentId);
  return (
    <SettingsContent>
      <Stack.SearchBar
        placeholder={t("mobile.server.audit.search")}
        autoCapitalize="none"
        hideWhenScrolling={false}
        // In a sheet, the header and its back button stay while the search has focus.
        hideNavigationBar={false}
        // The native Android search view draws black icons and text in both themes.
        {...(isAndroid
          ? { headerIconColor: String(foreground), textColor: String(foreground), hintTextColor: String(muted) }
          : {})}
        onChangeText={(event) => setSearch(event.nativeEvent.text)}
        onCancelButtonPress={() => setSearch("")}
        onClose={() => setSearch("")}
      />
      <SettingsNote>{t("mobile.server.audit.description")}</SettingsNote>
      <SettingsSection>
        <SettingsRow
          disclosure={false}
          trailing={
            <SettingsPicker
              value={filter}
              options={AUDIT_FILTERS.map((value) => ({ value, label: t(AUDIT_FILTER_KEYS[value]) }))}
              enabled
              dark={theme === "dark"}
              label={t("mobile.server.audit.filter")}
              onChange={setFilter}
            />
          }
        >
          <Typography.Paragraph>{t("mobile.server.audit.filter")}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title={t("mobile.server.audit.changes")}>
        {shown.length === 0 ? (
          <SettingsRow disclosure={false}>
            <Typography.Paragraph className="text-grouped-secondary">
              {rows.length ? t("mobile.server.audit.noMatch") : t("mobile.server.audit.empty")}
            </Typography.Paragraph>
          </SettingsRow>
        ) : null}
        {shown.map(({ entry, parts, actor }) => {
          const change = entry.change;
          const profile = change.kind === "agent-level" ? agent(change.agent.id) : undefined;
          const time = format.date(new Date(entry.at), { dateStyle: "medium", timeStyle: "short" });
          return (
            <SettingsRow
              key={entry.id}
              disclosure={false}
              supportingText={actor ? `${actor} · ${time}` : time}
              leading={
                change.kind === "agent-level" ? (
                  // A deleted agent keeps a face made from its ID, as on desktop.
                  <BloubAvatar
                    agentId={change.agent.id}
                    serverId={serverId}
                    hue={profile?.avatarHue ?? null}
                    seed={profile?.avatarSeed ?? change.agent.id}
                    size={36}
                    animateIdle={false}
                  />
                ) : (
                  <ChangeMark change={change} />
                )
              }
            >
              <AuditLine parts={parts} />
            </SettingsRow>
          );
        })}
      </SettingsSection>
    </SettingsContent>
  );
}
