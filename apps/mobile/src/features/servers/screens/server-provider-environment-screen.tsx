import {
  agentProviderName,
  isProviderEnvironmentProvider,
  PROVIDER_ENVIRONMENT_LIMITS,
  type ProviderEnvironmentProvider,
  type ProviderEnvironmentVariableInput,
  providerEnvironmentProblem,
} from "@openbot/contracts/ipc";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import Plus from "lucide-react-native/icons/plus";
import Trash2 from "lucide-react-native/icons/trash";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import Animated, { Easing, FadeOut, LinearTransition, ReduceMotion } from "react-native-reanimated";
import { useCSSVariable, useUniwind } from "uniwind";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import type { ProviderAdmin } from "@/features/servers/model/provider-admin";
import { useProviderAdmin } from "@/features/servers/model/use-server-providers";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { SettingsSwitch } from "@/features/settings/components/settings-controls";
import { RowIcon } from "@/features/settings/components/settings-row-icon";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { SheetSaveAction } from "@/shared/components/sheet-save-action";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
/** A removed variable fades, and the cards under it slide up. */
const ROW_EXIT = FadeOut.duration(150).easing(EASE_OUT).reduceMotion(ReduceMotion.System);
const ROW_LAYOUT = LinearTransition.duration(200).easing(EASE_OUT).reduceMotion(ReduceMotion.System);

/** The content of a list, to tell whether the user changed it. */
function snapshot(list: readonly Omit<Row, "id">[]): string {
  return JSON.stringify(list.map(({ name, value, sensitive, stored }) => ({ name, value, sensitive, stored })));
}

interface Row {
  /** A key for the list, so a typed character does not make the card again. */
  id: number;
  name: string;
  value: string;
  sensitive: boolean;
  /** The host has the value of this sensitive name; an empty field keeps it. */
  stored: boolean;
}

/**
 * Server settings > Providers > a provider > Variables (`provider-environment-v1`): the environment
 * variables that each process of the provider starts with, on the host. A sensitive value goes to the
 * host and does not come back; the phone does not keep it.
 */
export function ServerProviderEnvironmentScreen() {
  const { t } = useText();
  const params = useLocalSearchParams<{ serverId: string; provider: string }>();
  const { available, admin } = useProviderAdmin(params.serverId);
  const setting = admin?.environment;
  if (!available || !setting || !isProviderEnvironmentProvider(params.provider))
    return (
      <SettingsContent>
        <SettingsNote>{t("mobile.server.providers.unavailable")}</SettingsNote>
      </SettingsContent>
    );
  return <EnvironmentForm serverId={params.serverId} provider={params.provider} setting={setting} />;
}

function EnvironmentForm({
  serverId,
  provider,
  setting,
}: {
  serverId: string;
  provider: ProviderEnvironmentProvider;
  setting: NonNullable<ProviderAdmin["environment"]>;
}) {
  const { t, errorMessage } = useText();
  const { theme } = useUniwind();
  const accent = useCSSVariable("--openbot-accent");
  const queryScope = useQueryScope();
  const queryClient = useQueryClient();
  const queryKey = queryKeys.providerEnvironment(queryScope, serverId, provider);
  const current = useQuery({ queryKey, retry: false, staleTime: 0, queryFn: () => setting.read(provider) });
  const nextId = useRef(0);
  const [rows, setRows] = useState<Row[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = useRef(false);
  const name = agentProviderName(provider);
  const loaded = current.data;
  /** The answer that the rows started from, so a new answer does not replace a change of the user. */
  const lastLoaded = useRef<string | null>(null);
  // The form starts from the host's answer. A status event reads the variables again; the rows that the
  // user changed stay.
  useEffect(() => {
    if (!loaded) return;
    const previous = lastLoaded.current;
    lastLoaded.current = snapshot(loaded.variables);
    setRows((list) =>
      previous === null || snapshot(list) === previous
        ? loaded.variables.map((variable) => ({ ...variable, id: nextId.current++ }))
        : list,
    );
  }, [loaded]);

  if (!loaded)
    return (
      <SettingsContent>
        <SettingsNote>
          {current.isError
            ? errorMessage(current.error, t("mobile.server.environment.loadFailed", { name }))
            : t("mobile.server.providers.loading")}
        </SettingsNote>
      </SettingsContent>
    );

  const dirty = snapshot(rows) !== snapshot(loaded.variables);
  const names = rows.map((row) => row.name.trim());
  const problem = (row: Row): string | null => {
    const trimmed = row.name.trim();
    if (trimmed === "" && row.value === "") return null;
    const found = providerEnvironmentProblem(provider, trimmed, names);
    if (found === "name") return t("error.provider.environmentNameInvalid", { name: trimmed || "…" });
    if (found === "reserved") return t("error.provider.environmentNameReserved", { name: trimmed });
    if (found === "duplicate") return t("error.provider.environmentNameDuplicate", { name: trimmed });
    return null;
  };
  const invalid = rows.some((row) => problem(row) !== null);
  const update = (id: number, change: Partial<Row>) => {
    setError(null);
    setRows((list) => list.map((row) => (row.id === id ? { ...row, ...change } : row)));
  };

  async function save() {
    if (locked.current) return;
    if (invalid) {
      setError(t("mobile.server.environment.invalid"));
      return;
    }
    locked.current = true;
    setSaving(true);
    setError(null);
    const variables: ProviderEnvironmentVariableInput[] = rows
      .filter((row) => row.name.trim() !== "" || row.value !== "")
      .map((row) => ({
        name: row.name.trim(),
        // An empty field of a stored sensitive value keeps it.
        value: row.sensitive && row.stored && row.value === "" ? null : row.value,
        sensitive: row.sensitive,
      }));
    try {
      const next = await setting.set({ provider, variables });
      await queryClient.cancelQueries({ queryKey, exact: true });
      queryClient.setQueryData(queryKey, next);
      void haptics.notification("success");
      router.back();
    } catch (cause) {
      setError(errorMessage(cause, t("mobile.server.providers.actionFailed")));
      void haptics.notification("error");
    } finally {
      locked.current = false;
      setSaving(false);
    }
  }

  return (
    <SettingsContent>
      <SheetSaveAction
        dirty={dirty}
        canSave={!invalid}
        pending={saving}
        label={t("mobile.server.environment.save")}
        onSave={() => void save()}
      />
      <SettingsSection
        title={name}
        footer={
          error ??
          [
            t("mobile.server.environment.hint", { name }),
            provider === "codex" ? t("mobile.server.environment.codexHint") : null,
            t("mobile.server.environment.shellNote"),
          ]
            .filter((line) => line !== null)
            .join(" ")
        }
      >
        <SettingsRow
          disclosure={false}
          disabled={saving || rows.length >= PROVIDER_ENVIRONMENT_LIMITS.variables}
          leading={
            <View className="py-1.5 pr-1">
              <Plus size={22} color={String(accent)} strokeWidth={1.5} />
            </View>
          }
          onPress={() =>
            setRows((list) => [...list, { id: nextId.current++, name: "", value: "", sensitive: false, stored: false }])
          }
        >
          <Typography.Paragraph className="text-accent">{t("mobile.server.environment.add")}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
      {rows.map((row) => (
        <Animated.View key={row.id} exiting={ROW_EXIT} layout={ROW_LAYOUT}>
          <SettingsSection footer={problem(row) ?? undefined}>
            <SheetFormField
              hideLabel
              appearance="soft"
              label={t("mobile.server.environment.namePlaceholder")}
              placeholder={t("mobile.server.environment.namePlaceholder")}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!saving}
              maxLength={PROVIDER_ENVIRONMENT_LIMITS.name}
              value={row.name}
              // A new name needs its own value: the stored one belongs to the old name.
              onChangeText={(value) => update(row.id, { name: value, stored: false })}
            />
            <SheetFormField
              hideLabel
              appearance="soft"
              label={t("mobile.server.environment.valuePlaceholder")}
              placeholder={t(
                row.stored ? "mobile.server.environment.saved" : "mobile.server.environment.valuePlaceholder",
              )}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry={row.sensitive}
              editable={!saving}
              maxLength={PROVIDER_ENVIRONMENT_LIMITS.value}
              value={row.value}
              onChangeText={(value) => update(row.id, { value })}
            />
            <SettingsRow disclosure={false}>
              <SettingsSwitch
                value={row.sensitive}
                disabled={saving}
                label={t("mobile.server.environment.sensitive")}
                dark={theme === "dark"}
                onValueChange={(on) => update(row.id, { sensitive: on, stored: on && row.stored })}
              />
            </SettingsRow>
            <SettingsRow
              disclosure={false}
              disabled={saving}
              leading={<RowIcon icon={Trash2} tone="danger" />}
              onPress={() => {
                setError(null);
                setRows((list) => list.filter((item) => item.id !== row.id));
              }}
            >
              <Typography.Paragraph className="text-danger-text">
                {t("mobile.server.environment.remove")}
              </Typography.Paragraph>
            </SettingsRow>
          </SettingsSection>
        </Animated.View>
      ))}
    </SettingsContent>
  );
}
