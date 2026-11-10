import { useQuery } from "@tanstack/react-query";
import { router, Stack } from "expo-router";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import Check from "lucide-react-native/icons/check";
import { useState } from "react";
import { useCSSVariable } from "uniwind";
import { useAgentModelPicker } from "@/features/agents/model/agent-model-picker";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { haptics } from "@/shared/lib/haptics";
import { isAndroid } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";

/**
 * Agent settings > Model, and Create agent > Model: the models of the chosen provider, with a search.
 * A page, not a menu: a menu does not filter, and OpenRouter lists hundreds of models.
 */
export function AgentModelPickerScreen() {
  const { t } = useText();
  const accent = String(useCSSVariable("--openbot-accent"));
  const [foreground, muted] = useThemeColor(["foreground", "muted"]);
  const workspace = useMobileWorkspaceActions();
  const queryScope = useQueryScope();
  const request = useAgentModelPicker((state) => state.request);
  const [search, setSearch] = useState("");
  const serverId = request?.serverId ?? "";
  // The same query as the Model row, so the list shows at once from its cache.
  const models = useQuery({
    queryKey: queryKeys.agentModels(queryScope, serverId),
    queryFn: () => workspace.loadAgentModels(serverId),
    enabled: request !== null,
    retry: false,
  });
  const words = search.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  const options = models.data?.filter((option) => option.provider === request?.provider) ?? [];
  // The search also reads the model id, as the backup model search does.
  const matches = options.filter((option) => {
    const text = `${option.name} ${option.id}`.toLocaleLowerCase();
    return words.every((word) => text.includes(word));
  });

  return (
    // The native header holds the search field, which the Android blur header cannot draw.
    <SettingsContent androidNativeHeader>
      <Stack.Screen options={{ title: t("mobile.agent.runtime.model") }} />
      <Stack.SearchBar
        placeholder={t("mobile.agent.runtime.searchModels")}
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
      {!request ? (
        <SettingsNote>{t("mobile.agent.edit.gone")}</SettingsNote>
      ) : models.isError ? (
        <SettingsSection>
          <SettingsRow disclosure={false} onPress={() => void models.refetch()}>
            <Typography.Paragraph>{t("mobile.agent.runtime.retryModels")}</Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      ) : models.isPending ? (
        <SettingsNote>{t("mobile.agent.runtime.loadingModels")}</SettingsNote>
      ) : options.length === 0 ? (
        <SettingsNote>{t("mobile.agent.runtime.noModels")}</SettingsNote>
      ) : matches.length === 0 ? (
        <SettingsNote>{t("mobile.agent.runtime.noMatches")}</SettingsNote>
      ) : (
        <SettingsSection>
          {matches.map((option) => {
            const on = option.id === request.model;
            return (
              <SettingsRow
                key={option.id}
                checked={on}
                disclosure={false}
                supportingText={option.name === option.id ? undefined : option.id}
                trailing={on ? <Check size={18} color={accent} strokeWidth={2} /> : null}
                onPress={() => {
                  void haptics.selection();
                  request.choose(option.id);
                  router.back();
                }}
              >
                <Typography.Paragraph numberOfLines={2}>{option.name}</Typography.Paragraph>
              </SettingsRow>
            );
          })}
        </SettingsSection>
      )}
    </SettingsContent>
  );
}
