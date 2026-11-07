import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { agentProviderName, CUSTOM_PROVIDER_LIMITS, type CustomProviderSummary } from "@openbot/contracts/ipc";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { Typography } from "heroui-native";
import Bot from "lucide-react-native/icons/bot";
import Globe from "lucide-react-native/icons/globe";
import HardDrive from "lucide-react-native/icons/hard-drive";
import PackageSearch from "lucide-react-native/icons/package-search";
import { useEffect, useRef, useState } from "react";
import { Alert, View } from "react-native";
import { useCSSVariable } from "uniwind";
import { PairField } from "@/features/servers/components/repeatable-fields";
import {
  CUSTOM_PROVIDER_URL_EXAMPLE,
  type CustomProviderDraft,
  type CustomProviderPreset,
  customProviderDraftChanged,
  customProviderErrors,
  customProviderInput,
  customProviderReady,
  isCustomProviderPreset,
  presetCustomProviderDraft,
  suggestedCustomProviderId,
} from "@/features/servers/model/custom-provider-draft";
import type { ProviderAdmin } from "@/features/servers/model/provider-admin";
import { useProviderAdmin, useServerCustomProviders } from "@/features/servers/model/use-server-providers";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { SheetSaveAction } from "@/shared/components/sheet-save-action";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

/** The wire limit of a header name. */
const HEADER_NAME_LIMIT = 128;

// Examples, the same in each language. The desktop form shows the same ones.
const PROVIDER_ID_PLACEHOLDER = "my-provider";
const MODEL_ID_PLACEHOLDER = "model-id";
const HEADER_NAME_PLACEHOLDER = "Header-Name";

/**
 * Server settings > Providers > a custom provider of the host. Without `customProviderId` the page
 * lists the presets, and with `preset` it is the form of a new endpoint. The Team API has no edit
 * route, so a saved endpoint shows its settings and can be removed. The key and the header values go
 * to the host only, and the phone does not keep them.
 */
export function ServerCustomProviderScreen() {
  const { t, errorMessage } = useText();
  const { serverId, customProviderId, preset } = useLocalSearchParams<{
    serverId: string;
    customProviderId?: string;
    preset?: string;
  }>();
  const { available, admin } = useProviderAdmin(serverId);
  const custom = useServerCustomProviders(serverId, admin);
  const saved = customProviderId ? custom.list.data?.find((provider) => provider.id === customProviderId) : undefined;
  if (!available || !admin || (customProviderId && !saved))
    return (
      <SettingsContent>
        <SettingsNote>
          {!available || !admin
            ? t("mobile.server.providers.unavailable")
            : custom.list.isError
              ? errorMessage(custom.list.error, t("mobile.server.customProviders.loadFailed"))
              : custom.list.isPending
                ? t("mobile.server.customProviders.loading")
                : t("mobile.server.customProviders.gone")}
        </SettingsNote>
      </SettingsContent>
    );
  if (saved) return <SavedCustomProvider provider={saved} admin={admin} onList={custom.applyList} />;
  if (!isCustomProviderPreset(preset))
    return (
      <CustomProviderPresets
        serverId={serverId}
        registry={admin.registry !== null}
        customAgents={admin.customAgents !== null}
      />
    );
  return (
    <NewCustomProvider
      key={preset}
      serverId={serverId}
      preset={preset}
      admin={admin}
      taken={custom.list.data?.map((provider) => provider.id) ?? []}
      onList={custom.applyList}
    />
  );
}

const PRESET_ROWS = [
  {
    preset: "ollama",
    icon: HardDrive,
    title: "mobile.server.customProviders.preset.ollama",
    description: "mobile.server.customProviders.preset.ollamaDescription",
  },
  {
    preset: "lmstudio",
    icon: HardDrive,
    title: "mobile.server.customProviders.preset.lmstudio",
    description: "mobile.server.customProviders.preset.lmstudioDescription",
  },
  {
    preset: "openai-compatible",
    icon: Globe,
    title: "mobile.server.customProviders.preset.openaiCompatible",
    description: "mobile.server.customProviders.preset.openaiCompatibleDescription",
  },
] as const satisfies readonly {
  preset: CustomProviderPreset;
  icon: typeof Globe;
  title: MobileTextKey;
  description: MobileTextKey;
}[];

/** The first page of the add flow, as the preset list of desktop. A preset opens the form with its values. */
function CustomProviderPresets({
  serverId,
  registry,
  customAgents,
}: {
  serverId: string;
  registry: boolean;
  customAgents: boolean;
}) {
  const { t } = useText();
  const muted = String(useCSSVariable("--openbot-text-grouped-secondary"));
  return (
    <SettingsContent>
      <Stack.Screen options={{ title: t("mobile.server.customProviders.add") }} />
      <SettingsSection
        title={t("mobile.server.customProviders.models")}
        footer={t("mobile.server.customProviders.presetHint")}
      >
        {PRESET_ROWS.map((row) => (
          <SettingsRow
            key={row.preset}
            supportingText={t(row.description)}
            leading={
              <View className="py-1.5 pr-1">
                <row.icon size={22} color={muted} strokeWidth={1.5} />
              </View>
            }
            onPress={() =>
              router.push({ pathname: "/server-settings/custom-provider", params: { serverId, preset: row.preset } })
            }
          >
            <Typography.Paragraph numberOfLines={1}>{t(row.title)}</Typography.Paragraph>
          </SettingsRow>
        ))}
      </SettingsSection>
      {/* A host without `custom-agents-v1` has no route that adds an ACP agent, so the row says where to add one. */}
      <SettingsSection
        title={t("mobile.server.customProviders.agents")}
        footer={t(
          customAgents
            ? "mobile.server.customProviders.agentsCustomHint"
            : registry
              ? "mobile.server.customProviders.agentsRegistryHint"
              : "mobile.server.customProviders.agentsHint",
        )}
      >
        {registry ? (
          <SettingsRow
            supportingText={t("mobile.server.acpRegistry.rowDescription")}
            leading={
              <View className="py-1.5 pr-1">
                <PackageSearch size={22} color={muted} strokeWidth={1.5} />
              </View>
            }
            onPress={() => router.push({ pathname: "/server-settings/acp-registry", params: { serverId } })}
          >
            <Typography.Paragraph numberOfLines={1}>{t("mobile.server.route.acpRegistry")}</Typography.Paragraph>
          </SettingsRow>
        ) : null}
        <SettingsRow
          supportingText={t("mobile.server.customProviders.preset.acpDescription")}
          leading={
            <View className="py-1.5 pr-1">
              <Bot size={22} color={muted} strokeWidth={1.5} />
            </View>
          }
          trailing={
            customAgents ? undefined : (
              <Typography.Paragraph className="text-grouped-secondary">
                {t("mobile.server.customProviders.desktopOnly")}
              </Typography.Paragraph>
            )
          }
          onPress={
            customAgents
              ? () => router.push({ pathname: "/server-settings/custom-agent", params: { serverId } })
              : undefined
          }
        >
          <Typography.Paragraph numberOfLines={1}>{t("mobile.server.customProviders.preset.acp")}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
    </SettingsContent>
  );
}

/** Runs one change at a time, and leaves the page after it succeeds. */
function useLeavingAction(onFailure: (cause: unknown) => void, leave: () => void = () => router.back()) {
  const locked = useRef(false);
  const [pending, setPending] = useState(false);
  // Navigation runs a render later, once the discard guard reads `leaving`.
  const [leaving, setLeaving] = useState(false);
  const after = useRef<(() => void) | null>(null);
  const leaveRef = useRef(leave);
  leaveRef.current = leave;
  useEffect(() => {
    if (!leaving) return;
    leaveRef.current();
    after.current?.();
    after.current = null;
  }, [leaving]);
  return {
    pending,
    leaving,
    run(operation: () => Promise<() => void>) {
      if (locked.current) return;
      locked.current = true;
      setPending(true);
      operation()
        .then((next) => {
          void haptics.notification("success");
          // The list without a removed endpoint shows after this page goes, so the page does not say "gone".
          after.current = next;
          setLeaving(true);
        })
        .catch((cause: unknown) => {
          void haptics.notification("error");
          onFailure(cause);
        })
        .finally(() => {
          locked.current = false;
          setPending(false);
        });
    },
  };
}

function NewCustomProvider({
  serverId,
  preset,
  admin,
  taken,
  onList,
}: {
  serverId: string;
  preset: CustomProviderPreset;
  admin: ProviderAdmin;
  taken: readonly string[];
  onList: (providers: CustomProviderSummary[]) => Promise<void>;
}) {
  const { t, errorMessage } = useText();
  const [draft, setDraft] = useState<CustomProviderDraft>(() => presetCustomProviderDraft(preset));
  const initial = useRef(draft);
  const [error, setError] = useState<string | null>(null);
  // A new endpoint closes the preset page too, and shows the Providers page with it.
  const action = useLeavingAction(
    (cause) => setError(errorMessage(cause, t("mobile.server.customProviders.saveFailed"))),
    () => router.dismissTo({ pathname: "/server-settings/providers", params: { serverId } }),
  );
  const errors = customProviderErrors(draft, taken, t);
  const ready = customProviderReady(draft, errors);
  const dirty = customProviderDraftChanged(draft, initial.current);
  const locked = action.pending;

  // Discard turns prevention off before it repeats the action, so the hook does not warn.
  const [discarding, setDiscarding] = useState(false);
  usePreventRemove(!discarding && (dirty || action.pending) && !action.leaving, ({ repeat }) => {
    if (action.pending) return;
    void haptics.notification("warning");
    Alert.alert(t("mobile.agent.discard.title"), t("mobile.agent.discard.body"), [
      { text: t("mobile.agent.discard.keepEditing"), style: "cancel" },
      {
        text: t("mobile.agent.discard.discard"),
        style: "destructive",
        onPress: () => {
          setDiscarding(true);
          repeat();
        },
      },
    ]);
  });

  function edit(change: Partial<CustomProviderDraft>) {
    setDraft((current) => {
      const next = { ...current, ...change };
      // The ID follows the name until the user types one.
      return change.name !== undefined && !next.idEdited ? { ...next, id: suggestedCustomProviderId(next.name) } : next;
    });
    setError(null);
  }

  return (
    <SettingsContent>
      <Stack.Screen options={{ title: t("mobile.server.customProviders.add") }} />
      {/* A preset fills the form, so Add shows also before the first change. */}
      <SheetSaveAction
        dirty={dirty || ready}
        canSave={ready}
        pending={action.pending}
        label={t("mobile.server.customProviders.addConfirm")}
        pendingLabel={t("mobile.server.customProviders.adding")}
        onSave={() =>
          action.run(async () => {
            const result = await admin.saveCustom(customProviderInput(draft));
            return () => void onList(result.providers);
          })
        }
      />
      {error ? (
        <Typography.Paragraph accessibilityRole="alert" type="body-xs" className="px-4 text-danger-text">
          {error}
        </Typography.Paragraph>
      ) : null}
      <View className="gap-5">
        <SheetFormField
          label={t("mobile.server.customProviders.name")}
          isRequired
          placeholder={t("mobile.server.customProviders.namePlaceholder")}
          autoCorrect={false}
          maxLength={INPUT_LIMITS.agentName}
          editable={!locked}
          value={draft.name}
          onChangeText={(name) => edit({ name })}
        />
        <SheetFormField
          label={t("mobile.server.customProviders.id")}
          isRequired
          placeholder={PROVIDER_ID_PLACEHOLDER}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={INPUT_LIMITS.identifier}
          editable={!locked}
          value={draft.id}
          hint={errors.id ?? t("mobile.server.customProviders.idHint")}
          onChangeText={(id) => edit({ id, idEdited: id.length > 0 })}
        />
        <SheetFormField
          label={t("mobile.server.customProviders.baseUrl")}
          isRequired
          placeholder={CUSTOM_PROVIDER_URL_EXAMPLE}
          autoCapitalize="none"
          autoCorrect={false}
          inputMode="url"
          maxLength={CUSTOM_PROVIDER_LIMITS.baseUrl}
          editable={!locked}
          value={draft.baseUrl}
          hint={errors.baseUrl ?? t("mobile.server.customProviders.baseUrlHint")}
          onChangeText={(baseUrl) => edit({ baseUrl })}
        />
        <SheetFormField
          label={t("mobile.server.customProviders.apiKey")}
          placeholder={t("mobile.server.customProviders.apiKeyPlaceholder")}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          maxLength={CUSTOM_PROVIDER_LIMITS.apiKey}
          editable={!locked}
          value={draft.apiKey}
          hint={t("mobile.server.customProviders.apiKeyHint")}
          onChangeText={(apiKey) => edit({ apiKey })}
        />
      </View>
      <PairField
        title={t("mobile.server.customProviders.models")}
        footer={errors.models ?? t("mobile.server.customProviders.modelsHint")}
        items={draft.models}
        maxItems={CUSTOM_PROVIDER_LIMITS.models}
        maxKeyLength={INPUT_LIMITS.identifier}
        maxValueLength={INPUT_LIMITS.modelName}
        keyPlaceholder={MODEL_ID_PLACEHOLDER}
        valuePlaceholder={t("mobile.server.customProviders.modelName")}
        addLabel={t("mobile.server.customProviders.addModel")}
        keyLabel={(position) => t("mobile.server.customProviders.modelIdLabel", { position })}
        valueLabel={(position) => t("mobile.server.customProviders.modelNameLabel", { position })}
        removeLabel={(position) => t("mobile.server.customProviders.removeModel", { position })}
        disabled={locked}
        onChange={(models) => edit({ models })}
      />
      <PairField
        title={t("mobile.server.customProviders.headers")}
        footer={errors.headers ?? t("mobile.server.customProviders.headersHint")}
        items={draft.headers}
        maxItems={CUSTOM_PROVIDER_LIMITS.headers}
        maxKeyLength={HEADER_NAME_LIMIT}
        maxValueLength={CUSTOM_PROVIDER_LIMITS.apiKey}
        keyPlaceholder={HEADER_NAME_PLACEHOLDER}
        valuePlaceholder={t("mobile.server.customProviders.headerValue")}
        addLabel={t("mobile.server.customProviders.addHeader")}
        keyLabel={(position) => t("mobile.server.customProviders.headerNameLabel", { position })}
        valueLabel={(position) => t("mobile.server.customProviders.headerValueLabel", { position })}
        removeLabel={(position) => t("mobile.server.customProviders.removeHeader", { position })}
        disabled={locked}
        onChange={(headers) => edit({ headers })}
      />
    </SettingsContent>
  );
}

function SavedCustomProvider({
  provider,
  admin,
  onList,
}: {
  provider: CustomProviderSummary;
  admin: ProviderAdmin;
  onList: (providers: CustomProviderSummary[]) => Promise<void>;
}) {
  const { t, errorMessage } = useText();
  const [error, setError] = useState<string | null>(null);
  const action = useLeavingAction((cause) =>
    setError(errorMessage(cause, t("mobile.server.customProviders.removeFailed"))),
  );
  const value = (text: string) => (
    <Typography.Paragraph numberOfLines={1} className="shrink text-grouped-secondary">
      {text}
    </Typography.Paragraph>
  );
  return (
    <SettingsContent>
      <Stack.Screen options={{ title: provider.name }} />
      {error ? (
        <Typography.Paragraph accessibilityRole="alert" type="body-xs" className="px-4 text-danger-text">
          {error}
        </Typography.Paragraph>
      ) : null}
      <SettingsSection footer={t("mobile.server.customProviders.editHint")}>
        <SettingsRow disclosure={false} trailing={value(provider.id)}>
          <Typography.Paragraph>{t("mobile.server.customProviders.id")}</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow disclosure={false} trailing={value(provider.baseUrl)}>
          <Typography.Paragraph>{t("mobile.server.customProviders.baseUrl")}</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow
          disclosure={false}
          trailing={value(
            t(provider.hasApiKey ? "mobile.server.providers.keySaved" : "mobile.server.providers.keyMissing"),
          )}
        >
          <Typography.Paragraph>{t("mobile.server.customProviders.apiKey")}</Typography.Paragraph>
        </SettingsRow>
        {provider.harness ? (
          <SettingsRow disclosure={false} trailing={value(agentProviderName(provider.harness))}>
            <Typography.Paragraph>{t("mobile.server.customProviders.runsOn")}</Typography.Paragraph>
          </SettingsRow>
        ) : null}
      </SettingsSection>
      <SettingsSection title={t("mobile.server.customProviders.models")}>
        {provider.models.map((model) => (
          <SettingsRow
            key={model.id}
            disclosure={false}
            supportingText={model.name === model.id ? undefined : model.id}
          >
            <Typography.Paragraph numberOfLines={1}>{model.name}</Typography.Paragraph>
          </SettingsRow>
        ))}
      </SettingsSection>
      <SettingsSection>
        <SettingsRow
          disclosure={false}
          disabled={action.pending}
          onPress={() =>
            Alert.alert(
              t("mobile.server.customProviders.removeTitle", { name: provider.name }),
              t("mobile.server.customProviders.removeBody"),
              [
                { text: t("common.cancel"), style: "cancel" },
                {
                  text: t("mobile.server.customProviders.remove"),
                  style: "destructive",
                  onPress: () =>
                    action.run(async () => {
                      setError(null);
                      const result = await admin.deleteCustom(provider.id);
                      return () => void onList(result.providers);
                    }),
                },
              ],
            )
          }
        >
          <Typography.Paragraph className="text-danger-text">
            {t("mobile.server.customProviders.remove")}
          </Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
    </SettingsContent>
  );
}
