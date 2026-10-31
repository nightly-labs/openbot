import { type AcpRegistryEntry, CUSTOM_AGENT_LIMITS, isNewCustomAgentId } from "@openbot/contracts/ipc";
import { useLocalSearchParams } from "expo-router";
import { Spinner, Typography } from "heroui-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, View } from "react-native";
import { useCSSVariable } from "uniwind";
import type { ProviderAdmin } from "@/features/servers/model/provider-admin";
import { useProviderAdmin, useServerCustomAgents } from "@/features/servers/model/use-server-providers";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

/** How often the host is asked how an install is, as on desktop. */
const STATUS_POLL_MS = 1000;
/** The longest search that the host takes. */
const QUERY_LIMIT = 256;

type Registry = NonNullable<ProviderAdmin["registry"]>;

/**
 * The agent ID of a new install, as desktop suggests it, with a number added when the host has an
 * agent of that ID. The host does not replace an agent that it did not install from the registry.
 */
function suggestedAgentId(entry: AcpRegistryEntry, taken: ReadonlySet<string>): string {
  const base = isNewCustomAgentId(entry.id) ? entry.id : `registry-${entry.id}`.slice(0, 40);
  if (!taken.has(base)) return base;
  for (let number = 2; number <= CUSTOM_AGENT_LIMITS.agents + 1; number += 1) {
    const id = candidateId(base, number);
    if (!taken.has(id)) return id;
  }
  return base;
}

function candidateId(base: string, number: number): string {
  const suffix = `-${number}`;
  return `${base.slice(0, 40 - suffix.length)}${suffix}`;
}

/**
 * Server settings > Providers > ACP registry: the agents of the ACP registry, as the desktop section
 * shows them for a joined server. The host downloads and runs the command of each agent it installs.
 */
export function ServerAcpRegistryScreen() {
  const { t } = useText();
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const { available, admin } = useProviderAdmin(serverId);
  if (!available || !admin?.registry)
    return (
      <SettingsContent>
        <SettingsNote>
          {t(available ? "mobile.server.acpRegistry.unsupported" : "mobile.server.providers.unavailable")}
        </SettingsNote>
      </SettingsContent>
    );
  return <RegistryPage serverId={serverId} admin={admin} registry={admin.registry} />;
}

function RegistryPage({ serverId, admin, registry }: { serverId: string; admin: ProviderAdmin; registry: Registry }) {
  const { t, errorMessage } = useText();
  const accent = String(useCSSVariable("--openbot-accent"));
  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<AcpRegistryEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  /** The registry ID of the install, update or removal that runs on the host. */
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const searched = useRef("");
  // An install adds a custom agent, so the Agents section reads the list again after each change.
  const customAgents = useServerCustomAgents(serverId, admin);
  const hasCustomAgents = admin.customAgents !== null;
  const refetchAgents = customAgents.list.refetch;
  const refreshAgents = useCallback(() => {
    if (hasCustomAgents) void refetchAgents();
  }, [hasCustomAgents, refetchAgents]);
  const taken = new Set([
    ...(customAgents.list.data?.map((agent) => agent.id) ?? []),
    ...(entries?.flatMap((entry) => (entry.customAgentId ? [entry.customAgentId] : [])) ?? []),
  ]);

  const search = useCallback(
    async (text: string) => {
      searched.current = text;
      setLoading(true);
      setError(null);
      try {
        const [found, operations] = await Promise.all([registry.search(text), registry.status()]);
        if (searched.current !== text) return;
        setEntries(found);
        setBusy(operations.find((operation) => operation.state === "installing")?.registryId ?? null);
      } catch (cause) {
        setError(errorMessage(cause, t("mobile.server.acpRegistry.searchFailed")));
      } finally {
        setLoading(false);
      }
    },
    [registry, errorMessage, t],
  );

  // The whole registry shows before the first search.
  useEffect(() => {
    void search("");
  }, [search]);

  // An install runs on the host after its request answers, so the page reads its state until it ends.
  useEffect(() => {
    if (!busy) return;
    let current = true;
    let reading = false;
    const timer = setInterval(() => {
      if (reading) return;
      reading = true;
      registry
        .status()
        .then((operations) => {
          if (!current) return;
          const operation = operations.find((item) => item.registryId === busy);
          if (operation?.state === "installing") return;
          setBusy(null);
          if (operation?.state === "failed") {
            setError(operation.message ?? t("mobile.server.acpRegistry.installFailed"));
            void haptics.notification("error");
          }
          refreshAgents();
          void search(searched.current);
        })
        .catch((cause: unknown) => {
          if (current) setError(errorMessage(cause, t("mobile.server.acpRegistry.statusFailed")));
        })
        .finally(() => {
          reading = false;
        });
    }, STATUS_POLL_MS);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [busy, registry, search, errorMessage, t, refreshAgents]);

  async function change(entry: AcpRegistryEntry, failure: string, operation: () => Promise<unknown>) {
    setBusy(entry.id);
    setError(null);
    try {
      await operation();
      void haptics.notification("success");
      refreshAgents();
      await search(searched.current);
    } catch (cause) {
      setBusy(null);
      setError(errorMessage(cause, failure));
      void haptics.notification("error");
    }
  }

  const install = (entry: AcpRegistryEntry) =>
    void change(
      entry,
      t(entry.installedVersion ? "mobile.server.acpRegistry.updateFailed" : "mobile.server.acpRegistry.installFailed"),
      () =>
        registry.install({
          registryId: entry.id,
          customAgentId: entry.customAgentId ?? suggestedAgentId(entry, taken),
        }),
    );
  const remove = (entry: AcpRegistryEntry) =>
    void change(entry, t("mobile.server.acpRegistry.removeFailed"), () => registry.remove(entry.id));

  function open(entry: AcpRegistryEntry) {
    void haptics.selection();
    if (busy === entry.id) {
      Alert.alert(t("mobile.server.acpRegistry.cancelTitle", { name: entry.name }), undefined, [
        { text: t("mobile.server.acpRegistry.keepInstalling"), style: "cancel" },
        {
          text: t("mobile.server.acpRegistry.cancelInstall"),
          style: "destructive",
          onPress: () =>
            void registry.cancel(entry.id).then(
              () => search(searched.current),
              (cause: unknown) => setError(errorMessage(cause, t("mobile.server.acpRegistry.cancelFailed"))),
            ),
        },
      ]);
      return;
    }
    if (!entry.installedVersion) {
      Alert.alert(
        t("mobile.server.acpRegistry.installTitle", { name: entry.name }),
        t("mobile.server.acpRegistry.installBody", { id: entry.customAgentId ?? suggestedAgentId(entry, taken) }),
        [
          { text: t("common.cancel"), style: "cancel" },
          { text: t("mobile.server.acpRegistry.install"), onPress: () => install(entry) },
        ],
      );
      return;
    }
    Alert.alert(entry.name, t("mobile.server.acpRegistry.removeBody"), [
      { text: t("common.cancel"), style: "cancel" },
      ...(entry.installedVersion !== entry.version
        ? [{ text: t("mobile.server.acpRegistry.update"), onPress: () => install(entry) }]
        : []),
      { text: t("mobile.server.acpRegistry.remove"), style: "destructive" as const, onPress: () => remove(entry) },
    ]);
  }

  function status(entry: AcpRegistryEntry): string {
    if (busy === entry.id) return t("mobile.server.acpRegistry.installing");
    if (entry.distributions.length === 0) return t("mobile.server.acpRegistry.notAvailable");
    if (!entry.installedVersion) return t("mobile.server.acpRegistry.install");
    if (entry.installedVersion !== entry.version) return t("mobile.server.acpRegistry.update");
    return t("mobile.server.acpRegistry.installed");
  }

  const installed = entries?.filter((entry) => entry.installedVersion !== null) ?? [];
  const others = entries?.filter((entry) => entry.installedVersion === null) ?? [];
  const row = (entry: AcpRegistryEntry) => {
    const label = status(entry);
    const actionable =
      busy === entry.id || (busy === null && (entry.distributions.length > 0 || entry.installedVersion !== null));
    return (
      <SettingsRow
        key={entry.id}
        disclosure={false}
        disabled={!actionable}
        accessibilityLabel={t("mobile.server.acpRegistry.rowLabel", { name: entry.name, status: label })}
        trailing={
          busy === entry.id ? (
            <Spinner size="sm" color={accent} />
          ) : (
            <Typography.Paragraph
              className={
                !entry.installedVersion || entry.installedVersion !== entry.version
                  ? "text-accent"
                  : "text-grouped-secondary"
              }
            >
              {label}
            </Typography.Paragraph>
          )
        }
        onPress={actionable ? () => open(entry) : undefined}
      >
        <View className="gap-0.5">
          <Typography.Paragraph numberOfLines={1}>{entry.name}</Typography.Paragraph>
          <Typography.Paragraph type="body-xs" numberOfLines={2} className="text-grouped-secondary">
            {entry.description}
          </Typography.Paragraph>
          <Typography.Paragraph type="body-xs" className="text-grouped-secondary">
            {entry.installedVersion && entry.installedVersion !== entry.version
              ? t("mobile.server.acpRegistry.versions", {
                  installed: entry.installedVersion,
                  latest: entry.version,
                })
              : entry.version}
          </Typography.Paragraph>
        </View>
      </SettingsRow>
    );
  };

  return (
    <SettingsContent>
      <SheetFormField
        label={t("mobile.server.acpRegistry.search")}
        placeholder={t("mobile.server.acpRegistry.searchPlaceholder")}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={QUERY_LIMIT}
        returnKeyType="search"
        value={query}
        onChangeText={setQuery}
        onSubmitEditing={() => void search(query.trim())}
      />
      {error ? (
        <Typography.Paragraph accessibilityRole="alert" type="body-xs" className="px-4 text-danger-text">
          {error}
        </Typography.Paragraph>
      ) : null}
      {/* The agents that the server has, above the others, so an update or a removal is at the top. */}
      {installed.length > 0 ? (
        <SettingsSection title={t("mobile.server.acpRegistry.installedTitle")}>{installed.map(row)}</SettingsSection>
      ) : null}
      <SettingsSection
        title={t("mobile.server.acpRegistry.agents")}
        footer={t("mobile.server.acpRegistry.description")}
      >
        {loading && entries === null ? (
          <SettingsRow disclosure={false} trailing={<Spinner size="sm" color={accent} />}>
            <Typography.Paragraph className="text-grouped-secondary">
              {t("mobile.server.acpRegistry.loading")}
            </Typography.Paragraph>
          </SettingsRow>
        ) : null}
        {entries && others.length === 0 ? (
          <SettingsRow disclosure={false}>
            <Typography.Paragraph className="text-grouped-secondary">
              {t(installed.length > 0 ? "mobile.server.acpRegistry.emptyOthers" : "mobile.server.acpRegistry.empty")}
            </Typography.Paragraph>
          </SettingsRow>
        ) : null}
        {others.map(row)}
      </SettingsSection>
    </SettingsContent>
  );
}
