import { useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import { useState } from "react";
import { useGitHubRepositories, useServerConnectors } from "@/features/servers/model/use-server-connectors";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { useText } from "@/shared/lib/text";

/**
 * Server settings › Connectors › GitHub › Repositories: the repositories where the host's GitHub App is
 * installed, with a filter. The host sends at most a few hundred, so `total` can be larger.
 */
export function ServerGitHubRepositoriesScreen() {
  const { t, errorMessage } = useText();
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const { connectors, github } = useServerConnectors(serverId, null);
  const repositories = useGitHubRepositories(serverId, connectors && github.data?.state === "connected");
  const [search, setSearch] = useState("");
  const list = repositories.data;
  if (!list)
    return (
      <SettingsContent>
        <SettingsNote>
          {repositories.isError
            ? errorMessage(repositories.error, t("mobile.server.connectors.github.repositoriesFailed"))
            : !connectors || (github.data && github.data.state !== "connected")
              ? t("mobile.server.connectors.unavailable")
              : t("mobile.server.connectors.github.repositoriesLoading")}
        </SettingsNote>
      </SettingsContent>
    );
  const query = search.trim().toLowerCase();
  const matches = query
    ? list.repositories.filter((repository) => repository.fullName.toLowerCase().includes(query))
    : list.repositories;
  const more = list.total - list.repositories.length;
  return (
    <SettingsContent>
      {list.repositories.length > 0 ? (
        <SheetFormField
          label={t("mobile.server.connectors.github.filterLabel")}
          hideLabel
          placeholder={t("mobile.server.connectors.github.filterLabel")}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          value={search}
          onChangeText={setSearch}
        />
      ) : null}
      {list.repositories.length === 0 ? (
        <SettingsNote>{t("mobile.server.connectors.github.noRepositories")}</SettingsNote>
      ) : matches.length === 0 ? (
        <SettingsNote>{t("mobile.server.connectors.github.noMatch", { query: search.trim() })}</SettingsNote>
      ) : (
        <SettingsSection
          footer={
            !query && more > 0 ? t("mobile.server.connectors.github.moreRepositories", { count: more }) : undefined
          }
        >
          {matches.map((repository) => (
            <SettingsRow
              key={repository.fullName}
              disclosure={false}
              trailing={
                repository.private ? (
                  <Typography.Paragraph type="body-xs" className="text-grouped-secondary">
                    {t("mobile.server.connectors.github.private")}
                  </Typography.Paragraph>
                ) : undefined
              }
            >
              <Typography.Paragraph numberOfLines={1}>{repository.fullName}</Typography.Paragraph>
            </SettingsRow>
          ))}
        </SettingsSection>
      )}
    </SettingsContent>
  );
}
