import { Host, Switch } from "@expo/ui";
import { type InstalledSkill, SKILL_CREATION_REQUEST } from "@openbot/contracts/ipc";
import type { MobileTranslate } from "@openbot/i18n/mobile";
import { type QueryKey, useQueryClient } from "@tanstack/react-query";
import { Stack, useNavigation } from "expo-router";
import { StackActions } from "expo-router/react-navigation";
import { Typography } from "heroui-native";
import { useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import { useUniwind } from "uniwind";
import { requestComposerFocus, requestComposerText } from "@/features/chat/model/composer-requests";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { type MobileAgent, useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { haptics } from "@/shared/lib/haptics";
import { isIOS } from "@/shared/lib/platform";
import { currentText, useText } from "@/shared/lib/text";

/** The route name of an agent chat in the app stack, `app/(app)/chat/[agentId].tsx`. */
const CHAT_ROUTE = "chat/[agentId]";

/**
 * The header plus: as on desktop, it puts the skill-creation request in this agent's composer and
 * closes the sheet. The agent then asks what the skill is for and creates it in the chat.
 */
export function CreateSkillAction({ agent }: { agent: MobileAgent }) {
  const { t } = useText();
  // The stack that presents this sheet. The sheet has its own stack inside, so `router.dismissTo`
  // does not see the chat under it and would open a second, empty chat on top.
  const sheetStack = useNavigation().getParent();
  // The native stack keeps a closing sheet mounted until its animation ends, so this cleanup runs
  // after the dismissal, when the chat can keep the keyboard.
  const sent = useRef(false);
  useEffect(
    () => () => {
      if (sent.current) requestComposerFocus({ serverId: agent.serverId, agentId: agent.id });
    },
    [agent.serverId, agent.id],
  );
  return (
    <Stack.Toolbar placement="right">
      <Stack.Toolbar.Button
        icon={isIOS ? "plus" : undefined}
        accessibilityLabel={t("mobile.agent.skill.create")}
        onPress={() => {
          if (!sheetStack) return;
          void haptics.impact("light");
          requestComposerText({ serverId: agent.serverId, agentId: agent.id, text: SKILL_CREATION_REQUEST });
          sent.current = true;
          const state = sheetStack.getState();
          const below = state?.routes[state.index - 1];
          const params = below?.params;
          if (below?.name === CHAT_ROUTE && params && "agentId" in params && params.agentId === agent.id) {
            sheetStack.goBack();
          } else {
            // The sheet opened from the list: this agent's chat takes the place of the sheet.
            sheetStack.dispatch(StackActions.replace(CHAT_ROUTE, { agentId: agent.id }));
          }
        }}
      >
        {isIOS ? undefined : "+"}
      </Stack.Toolbar.Button>
    </Stack.Toolbar>
  );
}

/**
 * Agent info > Skills. An owner or admin turns a skill on or off and uninstalls it, as in the
 * desktop agent settings; a skill in a folder that OpenBot does not manage stays read-only.
 */
export function AgentSkills({
  agent,
  skills,
  manage,
  queryKey,
}: {
  agent: MobileAgent;
  skills: InstalledSkill[];
  manage: boolean;
  /** The query that holds `skills`. A saved change is written to it, so the list shows the host result. */
  queryKey: QueryKey;
}) {
  const { t } = useText();
  const workspace = useMobileWorkspace();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [removing, setRemoving] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  function updateSkills(change: (list: InstalledSkill[]) => InstalledSkill[]) {
    queryClient.setQueryData<InstalledSkill[] | null>(queryKey, (list) => list && change(list));
  }

  function run(skill: InstalledSkill, send: () => Promise<void>, failure: string, onFailure?: () => void) {
    setError(null);
    setBusy((current) => new Set(current).add(skill.skillId));
    send()
      .then(() => void haptics.notification("success"))
      .catch((cause: unknown) => {
        void haptics.notification("error");
        onFailure?.();
        setError(currentText().errorMessage(cause, failure));
      })
      .finally(() => setBusy((current) => withoutItem(current, skill.skillId)));
  }

  function setEnabled(skill: InstalledSkill, enabled: boolean) {
    void haptics.selection();
    const replace = (next: InstalledSkill) =>
      updateSkills((list) => list.map((item) => (item.skillId === skill.skillId ? next : item)));
    // The switch moves at once. A read that started earlier must not put the old state back.
    void queryClient.cancelQueries({ queryKey, exact: true });
    replace({ ...skill, enabled });
    run(
      skill,
      async () => {
        const saved = await workspace.setAgentSkillEnabled(
          { agentId: agent.id, skillId: skill.skillId, enabled },
          agent.serverId,
        );
        replace({ ...skill, ...saved });
      },
      currentText().t(enabled ? "mobile.agent.skill.enableFailed" : "mobile.agent.skill.disableFailed", {
        name: skill.name,
      }),
      () => replace(skill),
    );
  }

  function uninstall(skill: InstalledSkill) {
    setRemoving((current) => new Set(current).add(skill.skillId));
    run(
      skill,
      async () => {
        await workspace.uninstallAgentSkill(
          {
            agentId: agent.id,
            skillId: skill.skillId,
            ...(skill.state === "modified" ? { removeModified: true } : {}),
          },
          agent.serverId,
        );
        updateSkills((list) => list.filter((item) => item.skillId !== skill.skillId));
        setRemoving((current) => withoutItem(current, skill.skillId));
      },
      currentText().t("mobile.agent.skill.uninstallFailed", { name: skill.name }),
      () => setRemoving((current) => withoutItem(current, skill.skillId)),
    );
  }

  function confirmUninstall(skill: InstalledSkill) {
    const { t } = currentText();
    Alert.alert(
      t("mobile.agent.skill.uninstallTitle", { name: skill.name }),
      t(skill.state === "modified" ? "mobile.agent.skill.uninstallModifiedBody" : "mobile.agent.skill.uninstallBody"),
      [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("mobile.agent.skill.uninstall"), style: "destructive", onPress: () => uninstall(skill) },
      ],
    );
  }

  const managed = skills.filter((skill) => manage && skill.origin !== "workspace");
  const readOnly = skills.filter((skill) => !managed.includes(skill));
  return (
    <>
      {managed.map((skill) => (
        <ManagedSkill
          key={skill.skillId}
          skill={skill}
          busy={busy.has(skill.skillId)}
          removing={removing.has(skill.skillId)}
          onEnabledChange={(enabled) => setEnabled(skill, enabled)}
          onUninstall={() => confirmUninstall(skill)}
        />
      ))}
      {readOnly.length || !skills.length ? (
        <SettingsSection>
          {readOnly.map((skill) => (
            <SettingsRow key={skill.skillId} supportingText={skillMeta(skill, t, true)}>
              <Typography.Paragraph numberOfLines={1}>{skill.name}</Typography.Paragraph>
              <SkillDescription skill={skill} />
            </SettingsRow>
          ))}
          {!skills.length ? (
            <SettingsRow>
              <Typography.Paragraph className="text-grouped-secondary">
                {t("mobile.agent.info.noSkills")}
              </Typography.Paragraph>
            </SettingsRow>
          ) : null}
        </SettingsSection>
      ) : null}
      {error ? (
        <Typography.Paragraph accessibilityRole="alert" className="px-4 text-danger-text">
          {error}
        </Typography.Paragraph>
      ) : null}
    </>
  );
}

/** One group per skill: the native switch with its details, then the destructive action, as on the routine page. */
function ManagedSkill({
  skill,
  busy,
  removing,
  onEnabledChange,
  onUninstall,
}: {
  skill: InstalledSkill;
  busy: boolean;
  removing: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onUninstall: () => void;
}) {
  const { t } = useText();
  const { theme } = useUniwind();
  return (
    <SettingsSection>
      <SettingsRow supportingText={skillMeta(skill, t, false)}>
        <Host
          matchContents={{ vertical: true }}
          style={{ width: "100%" }}
          colorScheme={theme === "dark" ? "dark" : "light"}
        >
          {/* Older hosts send no `enabled`; such a skill is on. */}
          <Switch label={skill.name} value={skill.enabled !== false} disabled={busy} onValueChange={onEnabledChange} />
        </Host>
        <SkillDescription skill={skill} />
      </SettingsRow>
      <SettingsRow
        disclosure={false}
        disabled={busy}
        accessibilityLabel={t("mobile.agent.skill.uninstallNamed", { name: skill.name })}
        onPress={onUninstall}
      >
        <Typography.Paragraph className="text-danger-text">
          {t(removing ? "mobile.agent.skill.uninstalling" : "mobile.agent.skill.uninstall")}
        </Typography.Paragraph>
      </SettingsRow>
    </SettingsSection>
  );
}

function SkillDescription({ skill }: { skill: InstalledSkill }) {
  return skill.description ? (
    <Typography.Paragraph type="body-xs" numberOfLines={3} className="text-grouped-secondary">
      {skill.description}
    </Typography.Paragraph>
  ) : null;
}

function withoutItem(set: ReadonlySet<string>, item: string): ReadonlySet<string> {
  const next = new Set(set);
  next.delete(item);
  return next;
}

/** A row with a switch shows the enabled state in the switch, so the text does not repeat it. */
function skillMeta(skill: InstalledSkill, t: MobileTranslate, showDisabled: boolean): string {
  const parts = [
    skill.origin === "workspace"
      ? (skill.location ?? t("mobile.agent.skill.workspaceFolder"))
      : `v${skill.installedVersion}`,
    skill.state === "update-available"
      ? t("mobile.agent.skill.updateAvailable", { version: skill.availableVersion })
      : null,
    skill.state === "needs-repair" ? t("mobile.agent.skill.needsRepair") : null,
    skill.state === "modified" ? t("mobile.agent.skill.modified") : null,
    showDisabled && skill.enabled === false ? t("mobile.agent.skill.disabled") : null,
  ];
  return parts.filter(Boolean).join(" · ");
}
