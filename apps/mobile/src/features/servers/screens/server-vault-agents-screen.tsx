import { router, Stack } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { AgentChoiceRow, AgentSelectAllMenu } from "@/features/agents/components/agent-choice-list";
import { useVaultAgentPicker } from "@/features/servers/model/vault-agent-picker";
import { SettingsContent, SettingsNote, SettingsSection } from "@/features/settings/components/settings-content";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { haptics } from "@/shared/lib/haptics";
import { isIOS } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";

export function ServerVaultAgentsScreen() {
  const { t } = useText();
  const request = useVaultAgentPicker((state) => state.request);
  const [scope, setScope] = useState<string[] | null>(() => (request?.agents ? [...request.agents] : null));
  const [search, setSearch] = useState("");
  const serverId = request?.serverId ?? "";
  const allAgents = useMobileWorkspaceSelector((workspace) => workspace.agents);
  const agents = useMemo(() => allAgents.filter((agent) => agent.serverId === serverId), [allAgents, serverId]);
  useEffect(() => {
    if (!request && router.canGoBack()) router.back();
  }, [request]);
  const words = search.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  const matches = agents.filter((agent) => {
    const text = `${agent.name} ${agent.title}`.toLocaleLowerCase();
    return words.every((word) => text.includes(word));
  });
  const allows = (agentId: string) => scope === null || scope.includes(agentId);
  const set = (changed: readonly { id: string }[], on: boolean) => {
    if (!changed.length) return;
    const ids = new Set(changed.map((agent) => agent.id));
    const chosen = agents.filter((agent) => (ids.has(agent.id) ? on : allows(agent.id))).map((agent) => agent.id);
    const next = chosen.length === agents.length ? null : chosen;
    setScope(next);
    request?.onChange(next);
  };
  const toggle = (agentId: string) => set([{ id: agentId }], !allows(agentId));
  const toSelect = matches.filter((agent) => !allows(agent.id));
  const toDeselect = matches.filter((agent) => allows(agent.id));
  const setAll = (changed: readonly { id: string }[], on: boolean) => {
    if (!changed.length) return;
    void haptics.selection();
    set(changed, on);
  };

  return (
    <SettingsContent>
      <Stack.Screen options={{ title: t("mobile.server.vault.agents") }} />
      {request && agents.length > 0 ? (
        <AgentSelectAllMenu
          label={t("mobile.server.vault.agentOptions")}
          selectAll={t("mobile.server.vault.selectAll")}
          deselectAll={t("mobile.server.vault.deselectAll")}
          canSelect={toSelect.length > 0}
          canDeselect={toDeselect.length > 0}
          onSelectAll={() => setAll(toSelect, true)}
          onDeselectAll={() => setAll(toDeselect, false)}
        />
      ) : null}
      {isIOS ? (
        <Stack.SearchBar
          placeholder={t("mobile.server.vault.searchAgents")}
          autoCapitalize="none"
          hideWhenScrolling={false}
          hideNavigationBar={false}
          onChangeText={(event) => setSearch(event.nativeEvent.text)}
          onCancelButtonPress={() => setSearch("")}
        />
      ) : (
        <SheetFormField
          label={t("mobile.server.vault.searchAgents")}
          hideLabel
          appearance="soft"
          placeholder={t("mobile.server.vault.searchAgents")}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          value={search}
          onChangeText={setSearch}
        />
      )}
      {!request ? null : agents.length === 0 ? (
        <SettingsNote>{t("mobile.server.roles.noAgents")}</SettingsNote>
      ) : matches.length === 0 ? (
        <SettingsNote>{t("mobile.server.vault.noAgentMatches")}</SettingsNote>
      ) : (
        <SettingsSection
          footer={t(scope?.length === 0 ? "mobile.server.vault.agentsNone" : "mobile.server.vault.agentsAllHint")}
        >
          {matches.map((agent) => (
            <AgentChoiceRow
              key={agent.id}
              id={agent.id}
              name={agent.name}
              serverId={agent.serverId}
              avatarSeed={agent.avatarSeed}
              avatarHue={agent.avatarHue}
              avatarColor={agent.avatarColor}
              selected={allows(agent.id)}
              onToggle={toggle}
            />
          ))}
        </SettingsSection>
      )}
    </SettingsContent>
  );
}
