import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { ACP_AGENT_PRESETS, CUSTOM_AGENT_LIMITS, type CustomAgentSummary } from "@openbot/contracts/ipc";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { Typography } from "heroui-native";
import { useEffect, useRef, useState } from "react";
import { Alert, View } from "react-native";
import { useUniwind } from "uniwind";
import { ListField, PairField } from "@/features/servers/components/repeatable-fields";
import {
  CUSTOM_AGENT_ID_LIMIT,
  type CustomAgentDraft,
  customAgentDraft,
  customAgentDraftChanged,
  customAgentErrors,
  customAgentInput,
  customAgentReady,
  presetCustomAgentDraft,
  suggestedCustomAgentId,
} from "@/features/servers/model/custom-agent-draft";
import type { ProviderAdmin } from "@/features/servers/model/provider-admin";
import { useProviderAdmin, useServerCustomAgents } from "@/features/servers/model/use-server-providers";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { SettingsPicker } from "@/features/settings/components/settings-controls";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { SheetSaveAction } from "@/shared/components/sheet-save-action";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

// Examples, the same in each language. The desktop form shows the same ones.
const AGENT_ID_PLACEHOLDER = "my-agent";
const COMMAND_PLACEHOLDER = "my-agent";
const ARGUMENT_PLACEHOLDER = "acp";
const ENV_NAME_PLACEHOLDER = "NAME";
const USAGE_PROMPT_PLACEHOLDER = "/usage";
/** The "Start from" choice of no preset. */
const OTHER_PRESET = "";

type CustomAgents = NonNullable<ProviderAdmin["customAgents"]>;

/**
 * Server settings > Providers > a custom ACP agent of the host, or a new one without
 * `customAgentId` (`custom-agents-v1`). The host starts the command on its computer. A variable's
 * value goes to the host only, and the phone does not keep it.
 */
export function ServerCustomAgentScreen() {
  const { t, errorMessage } = useText();
  const { serverId, customAgentId } = useLocalSearchParams<{ serverId: string; customAgentId?: string }>();
  const { available, admin } = useProviderAdmin(serverId);
  const custom = useServerCustomAgents(serverId, admin);
  const saved = customAgentId ? custom.list.data?.find((agent) => agent.id === customAgentId) : undefined;
  if (!available || !admin?.customAgents || (customAgentId && !saved))
    return (
      <SettingsContent>
        <SettingsNote>
          {!available
            ? t("mobile.server.providers.unavailable")
            : !admin?.customAgents
              ? t("mobile.server.customAgents.unsupported")
              : custom.list.isError
                ? errorMessage(custom.list.error, t("mobile.server.customAgents.loadFailed"))
                : custom.list.isPending
                  ? t("mobile.server.customAgents.loading")
                  : t("mobile.server.customAgents.gone")}
        </SettingsNote>
      </SettingsContent>
    );
  return (
    <CustomAgentForm
      key={saved?.id ?? "new"}
      saved={saved}
      agents={admin.customAgents}
      taken={custom.list.data?.map((agent) => agent.id) ?? []}
      onList={custom.applyList}
    />
  );
}

function CustomAgentForm({
  saved,
  agents,
  taken,
  onList,
}: {
  saved: CustomAgentSummary | undefined;
  agents: CustomAgents;
  taken: readonly string[];
  onList: (agents: CustomAgentSummary[]) => Promise<void>;
}) {
  const { t, errorMessage } = useText();
  const { theme } = useUniwind();
  const [draft, setDraft] = useState<CustomAgentDraft>(() => customAgentDraft(saved));
  const [preset, setPreset] = useState(OTHER_PRESET);
  const [pending, setPending] = useState<"save" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const locked = useRef(false);
  // Navigation runs a render later, once the discard guard reads `leaving`.
  const [leaving, setLeaving] = useState(false);
  const nextList = useRef<CustomAgentSummary[] | null>(null);
  const showList = useRef(onList);
  showList.current = onList;
  useEffect(() => {
    if (!leaving) return;
    router.back();
    // The list without a removed agent shows after this page goes, so the page does not say "gone".
    const list = nextList.current;
    nextList.current = null;
    if (list) void showList.current(list);
  }, [leaving]);

  const errors = customAgentErrors(draft, saved, taken, t);
  const ready = customAgentReady(draft, errors);
  const dirty = customAgentDraftChanged(draft, saved);
  const busy = pending !== null;

  // Discard turns prevention off before it repeats the action, so the hook does not warn.
  const [discarding, setDiscarding] = useState(false);
  usePreventRemove(!discarding && (dirty || busy) && !leaving, ({ repeat }) => {
    if (busy) return;
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

  async function run(kind: "save" | "remove", operation: () => Promise<CustomAgentSummary[]>) {
    if (locked.current) return;
    locked.current = true;
    setPending(kind);
    setError(null);
    try {
      nextList.current = await operation();
      void haptics.notification("success");
      setLeaving(true);
    } catch (cause) {
      setError(
        errorMessage(
          cause,
          t(kind === "save" ? "mobile.server.customAgents.saveFailed" : "mobile.server.customAgents.removeFailed"),
        ),
      );
      void haptics.notification("error");
    } finally {
      locked.current = false;
      setPending(null);
    }
  }

  function edit(change: Partial<CustomAgentDraft>) {
    setDraft((current) => {
      const next = { ...current, ...change };
      // The ID of a new agent follows the name until the user types one.
      return change.name !== undefined && !next.idEdited && !saved
        ? { ...next, id: suggestedCustomAgentId(next.name) }
        : next;
    });
    setError(null);
  }

  return (
    <SettingsContent>
      <Stack.Screen options={{ title: saved ? saved.name : t("mobile.server.customAgents.addTitle") }} />
      <SheetSaveAction
        dirty={dirty}
        canSave={ready && !busy}
        pending={pending === "save"}
        label={saved ? undefined : t("mobile.server.customAgents.addConfirm")}
        pendingLabel={saved ? undefined : t("mobile.server.customAgents.adding")}
        onSave={() => void run("save", async () => (await agents.save(customAgentInput(draft, saved))).agents)}
      />
      {/* The command runs with the host's user account, so the page says so before the user adds one. */}
      <SettingsNote>{t("mobile.server.customAgents.trust")}</SettingsNote>
      {error ? (
        <Typography.Paragraph accessibilityRole="alert" type="body-xs" className="px-4 text-danger-text">
          {error}
        </Typography.Paragraph>
      ) : null}
      {saved ? null : (
        <SettingsSection footer={t("mobile.server.customAgents.presetHint")}>
          <SettingsRow
            disclosure={false}
            trailing={
              <SettingsPicker<string>
                value={preset}
                options={[
                  ...ACP_AGENT_PRESETS.map((candidate) => ({ value: candidate.id, label: candidate.name })),
                  { value: OTHER_PRESET, label: t("mobile.server.customAgents.presetOther") },
                ]}
                enabled={!busy}
                dark={theme === "dark"}
                label={t("mobile.server.customAgents.preset")}
                onChange={(next) => {
                  if (next === preset) return;
                  void haptics.selection();
                  setPreset(next);
                  setDraft((current) => presetCustomAgentDraft(current, next));
                  setError(null);
                }}
              />
            }
          >
            <Typography.Paragraph>{t("mobile.server.customAgents.preset")}</Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      )}
      <View className="gap-5">
        <SheetFormField
          label={t("mobile.server.customAgents.name")}
          isRequired
          placeholder={t("mobile.server.customAgents.namePlaceholder")}
          autoCorrect={false}
          maxLength={INPUT_LIMITS.agentName}
          editable={!busy}
          value={draft.name}
          onChangeText={(name) => edit({ name })}
        />
        <SheetFormField
          label={t("mobile.server.customAgents.id")}
          isRequired
          placeholder={AGENT_ID_PLACEHOLDER}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={CUSTOM_AGENT_ID_LIMIT}
          editable={!busy && !saved}
          value={draft.id}
          hint={errors.id ?? t("mobile.server.customAgents.idHint")}
          onChangeText={(id) => edit({ id, idEdited: id.length > 0 })}
        />
        <SheetFormField
          label={t("mobile.server.customAgents.command")}
          isRequired
          placeholder={COMMAND_PLACEHOLDER}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={CUSTOM_AGENT_LIMITS.command}
          editable={!busy}
          value={draft.command}
          hint={t("mobile.server.customAgents.commandHint")}
          onChangeText={(command) => edit({ command })}
        />
      </View>
      <ListField
        title={t("mobile.server.customAgents.arguments")}
        footer={t("mobile.server.customAgents.argumentsHint")}
        items={draft.args}
        maxItems={CUSTOM_AGENT_LIMITS.args}
        maxLength={CUSTOM_AGENT_LIMITS.arg}
        addLabel={t("mobile.server.customAgents.addArgument")}
        itemLabel={(position) => t("mobile.server.customAgents.argument", { position })}
        itemPlaceholder={ARGUMENT_PLACEHOLDER}
        removeLabel={(position) => t("mobile.server.customAgents.removeArgument", { position })}
        disabled={busy}
        onChange={(args) => edit({ args })}
      />
      <PairField
        title={t("mobile.server.customAgents.env")}
        footer={
          errors.env ??
          t(saved?.envNames.length ? "mobile.server.customAgents.envKeptHint" : "mobile.server.customAgents.envHint")
        }
        items={draft.env}
        maxItems={CUSTOM_AGENT_LIMITS.env}
        maxKeyLength={INPUT_LIMITS.identifier}
        maxValueLength={CUSTOM_AGENT_LIMITS.envValue}
        keyPlaceholder={ENV_NAME_PLACEHOLDER}
        valuePlaceholder={t("mobile.server.customAgents.envValue")}
        addLabel={t("mobile.server.customAgents.addVariable")}
        keyLabel={(position) => t("mobile.server.customAgents.variableName", { position })}
        valueLabel={(position) => t("mobile.server.customAgents.variableValue", { position })}
        removeLabel={(position) => t("mobile.server.customAgents.removeVariable", { position })}
        disabled={busy}
        onChange={(env) => edit({ env })}
      />
      <SheetFormField
        label={t("mobile.server.customAgents.usagePrompt")}
        placeholder={USAGE_PROMPT_PLACEHOLDER}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={CUSTOM_AGENT_LIMITS.usagePrompt}
        editable={!busy}
        value={draft.usagePrompt}
        hint={errors.usagePrompt ?? t("mobile.server.customAgents.usagePromptHint")}
        onChangeText={(usagePrompt) => edit({ usagePrompt })}
      />
      {saved ? (
        <SettingsSection>
          <SettingsRow
            disclosure={false}
            disabled={busy}
            onPress={() =>
              Alert.alert(
                t("mobile.server.customAgents.removeTitle", { name: saved.name }),
                t("mobile.server.customAgents.removeBody"),
                [
                  { text: t("common.cancel"), style: "cancel" },
                  {
                    text: t("mobile.server.customAgents.remove"),
                    style: "destructive",
                    onPress: () => void run("remove", async () => (await agents.remove(saved.id)).agents),
                  },
                ],
              )
            }
          >
            <Typography.Paragraph className="text-danger-text">
              {t("mobile.server.customAgents.remove")}
            </Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      ) : null}
    </SettingsContent>
  );
}
