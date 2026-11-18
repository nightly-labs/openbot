import { router, Stack } from "expo-router";
import { Typography } from "heroui-native";
import { useEffect, useMemo, useState } from "react";
import { AgentChoiceRow, AgentSelectAllMenu } from "@/features/agents/components/agent-choice-list";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { haptics } from "@/shared/lib/haptics";
import { isIOS } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";
import { useChannelAgentPicker } from "../model/channel-agent-picker";

/** Channel info > Agents, and New channel > Agents: the agents of the server, with a search. */
export function ChannelAgentPickerScreen() {
  const { t } = useText();
  const request = useChannelAgentPicker((state) => state.request);
  const [selected, setSelected] = useState(() => new Set(request?.members ?? []));
  const [search, setSearch] = useState("");
  const serverId = request?.serverId ?? "";
  const agents = useMobileWorkspaceSelector((current) => current.agents);
  const choices = useMemo(() => agents.filter((agent) => agent.serverId === serverId), [agents, serverId]);
  // Only the Agents row opens the page. Without its request there is no form to give the change to.
  useEffect(() => {
    if (!request && router.canGoBack()) router.back();
  }, [request]);
  const words = search.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  const matches = choices.filter((agent) => {
    const text = `${agent.name} ${agent.title}`.toLocaleLowerCase();
    return words.every((word) => text.includes(word));
  });
  const availableIds = new Set(choices.map((agent) => agent.id));
  const unavailable = [...selected].filter((id) => !availableIds.has(id));
  const toggle = (id: string) => {
    request?.toggle(id);
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  };
  // With a search, the menu acts on the agents that the search shows.
  const toSelect = matches.filter((agent) => !selected.has(agent.id));
  const toDeselect = matches.filter((agent) => selected.has(agent.id));
  const toggleAll = (agents: readonly { id: string }[]) => {
    if (!agents.length) return;
    void haptics.selection();
    for (const agent of agents) toggle(agent.id);
  };

  return (
    <SettingsContent>
      <Stack.Screen options={{ title: t("mobile.channel.form.agents") }} />
      {request && choices.length > 0 ? (
        <AgentSelectAllMenu
          label={t("mobile.channel.form.agentOptions")}
          selectAll={t("mobile.channel.form.selectAll")}
          deselectAll={t("mobile.channel.form.deselectAll")}
          canSelect={toSelect.length > 0}
          canDeselect={toDeselect.length > 0}
          onSelectAll={() => toggleAll(toSelect)}
          onDeselectAll={() => toggleAll(toDeselect)}
        />
      ) : null}
      {isIOS ? (
        <Stack.SearchBar
          placeholder={t("mobile.channel.form.searchAgents")}
          autoCapitalize="none"
          hideWhenScrolling={false}
          // In a sheet, the header and its back button stay while the search has focus.
          hideNavigationBar={false}
          onChangeText={(event) => setSearch(event.nativeEvent.text)}
          onCancelButtonPress={() => setSearch("")}
        />
      ) : (
        // The Android blur header cannot draw a `Stack.SearchBar`, so the field is in the content.
        <SheetFormField
          label={t("mobile.channel.form.searchAgents")}
          hideLabel
          appearance="soft"
          placeholder={t("mobile.channel.form.searchAgents")}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          value={search}
          onChangeText={setSearch}
        />
      )}
      {!request ? null : choices.length === 0 ? (
        <SettingsNote>{t("mobile.channel.form.noAgents")}</SettingsNote>
      ) : matches.length === 0 ? (
        <SettingsNote>{t("mobile.channel.form.noMatches")}</SettingsNote>
      ) : (
        <SettingsSection>
          {matches.map((agent) => (
            <AgentChoiceRow
              key={agent.id}
              id={agent.id}
              name={agent.name}
              serverId={agent.serverId}
              avatarSeed={agent.avatarSeed}
              avatarHue={agent.avatarHue}
              avatarColor={agent.avatarColor}
              selected={selected.has(agent.id)}
              onToggle={toggle}
            />
          ))}
        </SettingsSection>
      )}
      {request && unavailable.length > 0 ? (
        <SettingsSection>
          {unavailable.map((id) => (
            <SettingsRow key={id} disclosure={false} onPress={() => toggle(id)}>
              <Typography.Paragraph>{t("mobile.channel.form.removeUnavailable")}</Typography.Paragraph>
            </SettingsRow>
          ))}
        </SettingsSection>
      ) : null}
    </SettingsContent>
  );
}
