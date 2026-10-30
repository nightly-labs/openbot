import { isAgentProvider, providerDisplayName } from "@openbot/contracts/ipc";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import { useState } from "react";
import { View } from "react-native";
import { useUniwind } from "uniwind";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { ProviderMark } from "@/features/servers/components/provider-mark";
import { TrailingValue } from "@/features/servers/components/trailing-value";
import {
  type ProviderAdmin,
  type ProviderRow,
  providerRows,
  providerStatusText,
} from "@/features/servers/model/provider-admin";
import { useServerProviders } from "@/features/servers/model/use-server-providers";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { SettingsPicker } from "@/features/settings/components/settings-controls";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { haptics } from "@/shared/lib/haptics";
import { currentText, type MobileText, useText } from "@/shared/lib/text";

/** The status of a row, as the desktop Providers tab shows it. */
export function providerStatusLabel(row: ProviderRow, { t, format }: Pick<MobileText, "t" | "format">): string {
  const text = providerStatusText(row);
  return "percent" in text ? format.percent(Math.round(text.percent * 100) / 100) : t(text.key);
}

/**
 * Server settings > Providers: the AI providers of the computer that runs the server, for an owner or
 * admin of a host that serves `providers-v1`. A tap opens the provider, where it signs in, downloads
 * or updates on the host.
 */
export function ServerProvidersScreen() {
  const text = useText();
  const { t, errorMessage } = text;
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const { available, admin, status, runtimes, rows, applyRuntimes } = useServerProviders(serverId);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<string | null>(null);
  if (!available || !status.data)
    return (
      <SettingsContent>
        <SettingsNote>
          {!available
            ? t("mobile.server.providers.unavailable")
            : status.isError
              ? errorMessage(status.error, t("mobile.server.providers.loadFailed"))
              : t("mobile.server.providers.loading")}
        </SettingsNote>
      </SettingsContent>
    );
  // The connected providers first, then the others; a group with no provider is not shown.
  const connected = rows.filter((row) => row.status?.state === "available");
  const sections = [
    { title: t("mobile.server.providers.connectedTitle"), rows: connected },
    { title: t("mobile.server.providers.otherTitle"), rows: rows.filter((row) => !connected.includes(row)) },
  ].filter((section) => section.rows.length > 0);
  return (
    <SettingsContent>
      {admin?.defaultProvider ? (
        <DefaultProviderSection serverId={serverId} setting={admin.defaultProvider} rows={rows} />
      ) : null}
      {sections.map((section, index) => (
        <SettingsSection
          key={section.title}
          title={section.title}
          footer={
            index < sections.length - 1
              ? undefined
              : runtimes.isError
                ? errorMessage(runtimes.error, t("mobile.server.providers.runtimesFailed"))
                : t("mobile.server.providers.description")
          }
        >
          {section.rows.map((row) => (
            <SettingsRow
              key={row.id}
              supportingText={row.status?.email ?? undefined}
              leading={
                <View className="py-1.5 pr-1">
                  <ProviderMark provider={row.id} size={22} />
                </View>
              }
              trailing={<TrailingValue value={providerStatusLabel(row, text)} />}
              onPress={() =>
                router.push({ pathname: "/server-settings/provider", params: { serverId, provider: row.id } })
              }
            >
              <Typography.Paragraph numberOfLines={1}>{row.name}</Typography.Paragraph>
            </SettingsRow>
          ))}
        </SettingsSection>
      ))}
      {/* Only a host that downloads runtimes has updates to check. */}
      {runtimes.data && admin ? (
        <SettingsSection footer={checkResult ?? undefined}>
          <SettingsRow
            disclosure={false}
            disabled={checking}
            onPress={() => {
              setChecking(true);
              setCheckResult(null);
              admin
                .checkUpdates()
                .then(async (snapshot) => {
                  await applyRuntimes(snapshot);
                  const found = providerRows(status.data, snapshot, admin.capabilities).filter((row) => row.updatable);
                  setCheckResult(
                    found.length > 0
                      ? currentText().t("mobile.server.providers.updatesFound", {
                          names: currentText().format.list(found.map((row) => row.name)),
                        })
                      : currentText().t("mobile.server.providers.allUpToDate"),
                  );
                  void haptics.notification("success");
                })
                .catch((cause: unknown) => {
                  setCheckResult(errorMessage(cause, t("mobile.server.providers.checkFailed")));
                  void haptics.notification("error");
                })
                .finally(() => setChecking(false));
            }}
          >
            <Typography.Paragraph className="text-accent">
              {t(checking ? "mobile.server.providers.checking" : "mobile.server.providers.checkUpdates")}
            </Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      ) : null}
    </SettingsContent>
  );
}

/**
 * The provider that a new agent of the host starts on (`provider-default-v1`), as the Default
 * provider select of the desktop Providers tab: the connected providers and the current choice.
 */
function DefaultProviderSection({
  serverId,
  setting,
  rows,
}: {
  serverId: string;
  setting: NonNullable<ProviderAdmin["defaultProvider"]>;
  rows: readonly ProviderRow[];
}) {
  const { t, errorMessage } = useText();
  const { theme } = useUniwind();
  const queryScope = useQueryScope();
  const queryClient = useQueryClient();
  const queryKey = queryKeys.providerDefault(queryScope, serverId);
  const current = useQuery({ queryKey, retry: false, staleTime: 0, queryFn: () => setting.read() });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const value = current.data?.provider ?? null;
  const options: { value: string; label: string }[] = rows
    .filter((row) => (row.status?.state === "available" && !row.status.off) || row.id === value)
    .map((row) => ({ value: row.id, label: row.name }));
  if (!options.some((option) => option.value === (value ?? "")))
    options.unshift({
      value: value ?? "",
      label: value ? providerDisplayName(value) : t("mobile.agent.runtime.unavailable"),
    });
  const label = t("mobile.server.providers.defaultProvider");
  return (
    <SettingsSection
      footer={
        error ??
        (current.isError
          ? errorMessage(current.error, t("mobile.server.providers.loadFailed"))
          : t("mobile.server.providers.defaultProviderHint"))
      }
    >
      <SettingsRow
        trailing={
          <SettingsPicker<string>
            value={value ?? ""}
            options={options}
            enabled={current.isSuccess && !saving}
            dark={theme === "dark"}
            label={label}
            onChange={(next) => {
              if (!isAgentProvider(next) || next === value) return;
              setSaving(true);
              setError(null);
              setting
                .set(next)
                .then(async (saved) => {
                  await queryClient.cancelQueries({ queryKey, exact: true });
                  queryClient.setQueryData(queryKey, saved);
                  void haptics.notification("success");
                })
                .catch((cause: unknown) => {
                  setError(errorMessage(cause, t("mobile.server.providers.actionFailed")));
                  void haptics.notification("error");
                })
                .finally(() => setSaving(false));
            }}
          />
        }
      >
        <Typography.Paragraph>{label}</Typography.Paragraph>
      </SettingsRow>
    </SettingsSection>
  );
}
