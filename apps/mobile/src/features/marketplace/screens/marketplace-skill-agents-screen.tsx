import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { Spinner, Typography } from "heroui-native";
import Check from "lucide-react-native/icons/check";
import { useEffect, useRef, useState } from "react";
import { useCSSVariable } from "uniwind";
import { AvatarThumbnail } from "@/features/agents/components/bloub-avatar";
import { mobileAnalytics } from "@/features/analytics/mobile-analytics";
import { useMobileSession, useQueryScope } from "@/features/auth/context/mobile-session-context";
import { SettingsNote, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import {
  useMobileWorkspaceActions,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { SheetSaveAction } from "@/shared/components/sheet-save-action";
import { SheetScrollView } from "@/shared/components/sheet-scroll-view";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import { loadMarketplaceSkill } from "../api/marketplace-catalog";
import { useMarketplaceInstalled } from "../model/use-marketplace";

/**
 * The second page of a skill's sheet: the agents of the server, to choose the ones that get the skill.
 * An agent that has it already shows so. Add skill installs it on each chosen agent, then goes back.
 */
export function MarketplaceSkillAgentsScreen() {
  const { t, errorMessage } = useText();
  const { serverId, skillId } = useLocalSearchParams<{ serverId: string; skillId: string }>();
  const { session } = useMobileSession();
  const apiUrl = session?.apiUrl ?? null;
  // The listing page read it already, so this answers from the cache.
  const skill = useQuery({
    queryKey: queryKeys.marketplace(apiUrl, "skill", skillId),
    enabled: apiUrl !== null,
    retry: false,
    queryFn: ({ signal }) => loadMarketplaceSkill(apiUrl ?? "", skillId, signal),
  });
  const { installAgentSkill } = useMobileWorkspaceActions();
  const queryClient = useQueryClient();
  const queryScope = useQueryScope();
  const canManage = useMobileWorkspaceSelector((workspace) => workspace.canManageAgentSkills(serverId));
  const installed = useMarketplaceInstalled(serverId);
  const holders = new Set(installed.skillAgentIds(skillId));
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accent = String(useCSSVariable("--openbot-accent-text"));
  const lock = useRef(false);
  const [leaving, setLeaving] = useState(false);
  usePreventRemove(pending, () => undefined);
  // Back only after the render that releases the guard, or the guard keeps the page.
  useEffect(() => {
    if (leaving) router.back();
  }, [leaving]);

  function toggle(agentId: string) {
    void haptics.selection();
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });
  }

  async function install() {
    const detail = skill.data;
    if (lock.current || chosen.size === 0 || !detail) return;
    lock.current = true;
    setPending(true);
    setError(null);
    const added: string[] = [];
    try {
      await mobileAnalytics.operation("marketplace_action", { entity: "skill", action: "install" }, async () => {
        for (const agentId of chosen) {
          await installAgentSkill({ agentId, skillId: detail.id, versionId: detail.versionId }, serverId);
          added.push(agentId);
        }
      });
      void haptics.notification("success");
      setPending(false);
      setLeaving(true);
    } catch (cause) {
      void haptics.notification("error");
      setError(errorMessage(cause, t("mobile.marketplace.installFailed")));
      // The agents that have it now leave the choice; the others stay for a retry.
      setChosen((current) => new Set([...current].filter((agentId) => !added.includes(agentId))));
      lock.current = false;
      setPending(false);
    } finally {
      // The agent pages and the listing read the skills again, with the ones that were added.
      for (const agentId of added)
        void queryClient.invalidateQueries({ queryKey: queryKeys.agentInfo(queryScope, serverId, agentId) });
    }
  }

  return (
    <SheetScrollView
      className="bg-sheet"
      contentContainerClassName="gap-5 px-4 pb-safe-offset-5 pt-5"
      contentInsetAdjustmentBehavior="automatic"
    >
      <Stack.Screen
        options={{ title: t("mobile.marketplace.skill.chooseAgents"), headerBackButtonDisplayMode: "minimal" }}
      />
      <SheetSaveAction
        dirty={chosen.size > 0}
        canSave={canManage && skill.data !== undefined}
        pending={pending}
        label={t("mobile.marketplace.skill.add")}
        pendingLabel={t("mobile.marketplace.skill.adding")}
        onSave={() => void install()}
      />
      {skill.isPending ? <Spinner className="mt-10 self-center" /> : null}
      {error ? (
        <Typography.Paragraph accessibilityRole="alert" className="px-4 text-danger-text">
          {error}
        </Typography.Paragraph>
      ) : null}
      {installed.agents.length === 0 ? (
        <SettingsNote>{t("mobile.marketplace.skill.noServerAgents")}</SettingsNote>
      ) : (
        <SettingsSection
          title={skill.data ? t("mobile.marketplace.skill.addNamed", { name: skill.data.name }) : undefined}
          footer={t("mobile.marketplace.skill.addToHint")}
        >
          {installed.agents.map((agent) => {
            const has = holders.has(agent.id);
            const selected = chosen.has(agent.id);
            return (
              <SettingsRow
                key={agent.id}
                leading={<AvatarThumbnail seed={agent.avatarSeed} hue={agent.avatarHue} size={30} />}
                disabled={has || pending}
                disclosure={false}
                accessibilityLabel={has ? t("mobile.marketplace.skill.agentHasIt", { name: agent.name }) : agent.name}
                trailing={
                  has ? (
                    <Typography.Paragraph type="body-sm" className="text-grouped-secondary">
                      {t("mobile.marketplace.skill.hasIt")}
                    </Typography.Paragraph>
                  ) : selected ? (
                    <Check color={accent} size={20} strokeWidth={2.4} />
                  ) : undefined
                }
                onPress={has ? undefined : () => toggle(agent.id)}
              >
                <Typography.Paragraph numberOfLines={1}>{agent.name}</Typography.Paragraph>
              </SettingsRow>
            );
          })}
        </SettingsSection>
      )}
    </SheetScrollView>
  );
}
