import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { McpServerConfig, McpTestResult, McpTransport } from "@openbot/contracts/ipc";
import { matchingSourceKeys } from "@openbot/i18n/source";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { Typography } from "heroui-native";
import { useEffect, useRef, useState } from "react";
import { Alert, View } from "react-native";
import { useUniwind } from "uniwind";
import { ListField, PairField } from "@/features/servers/components/repeatable-fields";
import {
  type McpServerDraft,
  mcpServerConfig,
  mcpServerDraft,
  mcpServerDraftChanged,
  mcpServerDraftErrors,
} from "@/features/servers/model/mcp-server-draft";
import { useServerMcp } from "@/features/servers/model/use-server-mcp";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { SettingsPicker, SettingsSwitch } from "@/features/settings/components/settings-controls";
import { useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { SheetSaveAction } from "@/shared/components/sheet-save-action";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

/** The host answers that the server wants a sign-in. This phone cannot sign in to an MCP server yet. */
const SIGN_IN_ERRORS = new Set([
  "error.backend.mcpSignInRequired",
  "error.backend.mcpSignInOnHost",
  "error.backend.mcpSignInTimedOut",
  "error.mcp.signInOnHost",
]);

// Code, paths and addresses, the same in each language. The desktop form shows the same examples.
const COMMAND_PLACEHOLDER = "openai-dev-mcp";
const WORKING_DIRECTORY_PLACEHOLDER = "~/code";
const URL_PLACEHOLDER = "https://mcp.example.com/mcp";

type TestState = { status: "testing" } | { status: "done"; result: McpTestResult };

/**
 * Server sheet > MCP servers > one server, or a new one without `mcpServerId`. The header action
 * saves it. A saved server turns on and off at once, and can be tested, signed out and removed.
 */
export function ServerMcpServerScreen() {
  const { t } = useText();
  const { serverId, mcpServerId } = useLocalSearchParams<{ serverId: string; mcpServerId?: string }>();
  const mcp = useServerMcp(serverId);
  const saved = mcpServerId ? mcp.list.data?.find((config) => config.id === mcpServerId) : undefined;
  if (!mcp.server || !mcp.canManage || (mcpServerId && !saved))
    return (
      <SettingsContent>
        <SettingsNote>
          {!mcp.server
            ? t("mobile.server.unavailable")
            : !mcp.canManage
              ? t("mobile.server.mcp.unavailable")
              : mcp.list.isPending && !mcp.list.isError
                ? t("mobile.server.mcp.loading")
                : t("mobile.server.mcp.gone")}
        </SettingsNote>
      </SettingsContent>
    );
  return <McpServerForm key={saved?.id ?? "new"} serverId={serverId} saved={saved} mcp={mcp} />;
}

function McpServerForm({
  serverId,
  saved,
  mcp,
}: {
  serverId: string;
  saved: McpServerConfig | undefined;
  mcp: ReturnType<typeof useServerMcp>;
}) {
  const { t, sourceText, errorMessage } = useText();
  const { theme } = useUniwind();
  const { saveMcpServer, removeMcpServer, setMcpServerEnabled, testMcpServer, signOutMcpServer } =
    useMobileWorkspaceActions();
  const { action, perform, setList, setSignIns } = mcp;
  const [draft, setDraft] = useState<McpServerDraft>(() => mcpServerDraft(saved));
  // A new server keeps its switch in the draft. A saved one turns on and off at once.
  const [newEnabled, setNewEnabled] = useState(true);
  const [test, setTest] = useState<TestState | null>(null);
  // Each test and each edit makes the result of an older test stale.
  const testRun = useRef(0);
  // Navigation runs a render later, once the guard below reads `leaving`.
  const [leaving, setLeaving] = useState(false);
  // The list without a removed server. It is shown after this page goes, so the page does not say "gone".
  const removedList = useRef<McpServerConfig[] | null>(null);
  const showList = useRef(setList);
  showList.current = setList;
  useEffect(() => {
    if (!leaving) return;
    router.back();
    const list = removedList.current;
    removedList.current = null;
    if (list) void showList.current(list);
  }, [leaving]);
  const enabled = saved?.enabled ?? newEnabled;
  const config = mcpServerConfig(draft, saved?.id ?? "", enabled);
  const errors = mcpServerDraftErrors(config);
  const valid = !errors.name && !errors.command && !errors.url;
  const dirty = mcpServerDraftChanged(draft, saved);
  const signedIn =
    saved?.transport === "http" &&
    Boolean(mcp.signIns.data?.some((state) => state.mcpServerId === saved.id && state.signedIn));
  const busy = action.isPending || test?.status === "testing";

  // Discard turns prevention off before it repeats the action, so the hook does not warn.
  const [discarding, setDiscarding] = useState(false);
  usePreventRemove(!discarding && (dirty || action.isPending) && !leaving, ({ repeat }) => {
    if (action.isPending) return;
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

  function edit(change: Partial<McpServerDraft>) {
    setDraft((current) => ({ ...current, ...change }));
    // A result describes the settings that were tested.
    testRun.current += 1;
    setTest(null);
    if (action.error) action.reset();
  }

  function save() {
    void perform(async () => {
      await setList(await saveMcpServer(config, serverId));
    }).then((done) => {
      if (done) setLeaving(true);
    });
  }

  function runTest() {
    if (busy || !valid) return;
    const run = ++testRun.current;
    setTest({ status: "testing" });
    testMcpServer(config, serverId)
      .then((result) => {
        if (run !== testRun.current) return;
        void haptics.notification(result.error ? "error" : "success");
        setTest({ status: "done", result });
      })
      .catch((cause: unknown) => {
        if (run !== testRun.current) return;
        void haptics.notification("error");
        setTest({
          status: "done",
          result: { toolCount: 0, error: errorMessage(cause, t("mobile.server.mcp.testFailed")) },
        });
      });
  }

  function testMessage(state: TestState): string {
    if (state.status === "testing") return t("mobile.server.mcp.testing");
    const { error, toolCount } = state.result;
    if (!error) return t("mobile.server.mcp.connected", { count: toolCount });
    const key = matchingSourceKeys(error)[0];
    return key && SIGN_IN_ERRORS.has(key) ? t("mobile.server.mcp.signInOnComputer") : sourceText(error);
  }

  const locked = action.isPending;
  return (
    <SettingsContent>
      <Stack.Screen options={{ title: saved ? saved.name : t("mobile.server.mcp.addTitle") }} />
      <SheetSaveAction
        dirty={dirty}
        canSave={valid && !busy}
        pending={action.isPending && dirty}
        label={saved ? undefined : t("mobile.server.mcp.addConfirm")}
        onSave={save}
      />
      <View className="gap-5">
        <SheetFormField
          label={t("mobile.server.mcp.name")}
          isRequired
          placeholder={t("mobile.server.mcp.namePlaceholder")}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={INPUT_LIMITS.mcpServerName}
          editable={!locked}
          value={draft.name}
          hint={
            draft.name.trim() && errors.name
              ? t("mobile.server.mcp.nameReserved", { name: draft.name.trim() })
              : undefined
          }
          onChangeText={(name) => edit({ name })}
        />
        <SettingsSection
          footer={
            draft.transport === "http"
              ? t("mobile.server.mcp.httpDescription")
              : config.workingDirectory
                ? t("mobile.server.mcp.providerLimit")
                : t("mobile.server.mcp.stdioDescription")
          }
        >
          <SettingsRow
            disclosure={false}
            trailing={
              <SettingsPicker<McpTransport>
                value={draft.transport}
                options={[
                  { value: "stdio", label: t("mobile.server.mcp.stdio") },
                  { value: "http", label: t("mobile.server.mcp.http") },
                ]}
                enabled={!locked}
                dark={theme === "dark"}
                label={t("mobile.server.mcp.transport")}
                onChange={(transport) => {
                  if (transport === draft.transport) return;
                  void haptics.selection();
                  edit({ transport });
                }}
              />
            }
          >
            <Typography.Paragraph>{t("mobile.server.mcp.transport")}</Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      </View>
      {draft.transport === "stdio" ? (
        <View className="gap-5">
          <SheetFormField
            label={t("mobile.server.mcp.command")}
            isRequired
            placeholder={COMMAND_PLACEHOLDER}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={INPUT_LIMITS.mcpCommand}
            editable={!locked}
            value={draft.command}
            hint={t("mobile.server.mcp.commandHint")}
            onChangeText={(command) => edit({ command })}
          />
          <ListField
            title={t("mobile.server.mcp.arguments")}
            footer={t("mobile.server.mcp.argumentsHint")}
            items={draft.args}
            maxItems={INPUT_LIMITS.mcpArgs}
            maxLength={INPUT_LIMITS.mcpArgValue}
            addLabel={t("mobile.server.mcp.addArgument")}
            itemLabel={(position) => t("mobile.server.mcp.argument", { position })}
            removeLabel={(position) => t("mobile.server.mcp.removeArgument", { position })}
            disabled={locked}
            onChange={(args) => edit({ args })}
          />
          <PairField
            title={t("mobile.server.mcp.environment")}
            footer={t("mobile.server.mcp.environmentHint")}
            items={draft.env}
            maxItems={INPUT_LIMITS.mcpEnvVariables}
            maxKeyLength={INPUT_LIMITS.mcpEnvName}
            maxValueLength={INPUT_LIMITS.mcpEnvValue}
            keyPlaceholder={t("mobile.server.mcp.key")}
            valuePlaceholder={t("mobile.server.mcp.value")}
            addLabel={t("mobile.server.mcp.addVariable")}
            keyLabel={(position) => t("mobile.server.mcp.variableKey", { position })}
            valueLabel={(position) => t("mobile.server.mcp.variableValue", { position })}
            removeLabel={(position) => t("mobile.server.mcp.removeVariable", { position })}
            disabled={locked}
            onChange={(env) => edit({ env })}
          />
          <ListField
            title={t("mobile.server.mcp.passthrough")}
            footer={t("mobile.server.mcp.passthroughHint", { server: mcp.server?.name ?? "" })}
            items={draft.envPassthrough}
            maxItems={INPUT_LIMITS.mcpEnvVariables}
            maxLength={INPUT_LIMITS.mcpEnvName}
            autoCapitalize="characters"
            addLabel={t("mobile.server.mcp.addPassthrough")}
            itemLabel={(position) => t("mobile.server.mcp.passthroughVariable", { position })}
            removeLabel={(position) => t("mobile.server.mcp.removePassthrough", { position })}
            disabled={locked}
            onChange={(envPassthrough) => edit({ envPassthrough })}
          />
          <SheetFormField
            label={t("mobile.server.mcp.workingDirectory")}
            placeholder={WORKING_DIRECTORY_PLACEHOLDER}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={INPUT_LIMITS.mcpCommand}
            editable={!locked}
            value={draft.workingDirectory}
            hint={t("mobile.server.mcp.workingDirectoryHint")}
            onChangeText={(workingDirectory) => edit({ workingDirectory })}
          />
        </View>
      ) : (
        <View className="gap-5">
          <SheetFormField
            label={t("mobile.server.mcp.url")}
            isRequired
            placeholder={URL_PLACEHOLDER}
            autoCapitalize="none"
            autoCorrect={false}
            inputMode="url"
            maxLength={INPUT_LIMITS.mcpUrl}
            editable={!locked}
            value={draft.url}
            hint={draft.url.trim() && errors.url ? t("mobile.server.mcp.urlInvalid") : undefined}
            onChangeText={(url) => edit({ url })}
          />
          <PairField
            title={t("mobile.server.mcp.headers")}
            footer={t("mobile.server.mcp.headersHint")}
            items={draft.headers}
            maxItems={INPUT_LIMITS.mcpHeaders}
            maxKeyLength={INPUT_LIMITS.mcpEnvName}
            maxValueLength={INPUT_LIMITS.mcpHeaderValue}
            keyPlaceholder={t("mobile.server.mcp.key")}
            valuePlaceholder={t("mobile.server.mcp.value")}
            addLabel={t("mobile.server.mcp.addHeader")}
            keyLabel={(position) => t("mobile.server.mcp.headerName", { position })}
            valueLabel={(position) => t("mobile.server.mcp.headerValue", { position })}
            removeLabel={(position) => t("mobile.server.mcp.removeHeader", { position })}
            disabled={locked}
            onChange={(headers) => edit({ headers })}
          />
        </View>
      )}
      <SettingsSection footer={t("mobile.server.mcp.enabledDescription")}>
        <SettingsRow>
          <SettingsSwitch
            value={enabled}
            disabled={locked}
            label={t("mobile.server.mcp.enabledLabel")}
            dark={theme === "dark"}
            onValueChange={(next) => {
              if (!saved) {
                setNewEnabled(next);
                return;
              }
              void perform(async () => {
                await setList(await setMcpServerEnabled(saved.id, next, serverId));
              });
            }}
          />
        </SettingsRow>
      </SettingsSection>
      <SettingsSection footer={test ? testMessage(test) : t("mobile.server.mcp.testDescription")}>
        <SettingsRow disclosure={false} disabled={busy || !valid} onPress={runTest}>
          <Typography.Paragraph className="text-accent">
            {test?.status === "testing" ? t("mobile.server.mcp.testing") : t("mobile.server.mcp.test")}
          </Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
      {signedIn && saved ? (
        <SettingsSection footer={t("mobile.server.mcp.signedInDescription", { server: mcp.server?.name ?? "" })}>
          <SettingsRow
            disclosure={false}
            disabled={busy}
            onPress={() =>
              void perform(async () => {
                setSignIns(await signOutMcpServer(saved.id, serverId));
              })
            }
          >
            <Typography.Paragraph className="text-accent">{t("mobile.server.mcp.signOut")}</Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      ) : null}
      {action.error ? (
        <Typography.Paragraph accessibilityRole="alert" type="body-xs" className="-mt-4 px-4 text-danger-text">
          {errorMessage(action.error, t("mobile.server.mcp.saveFailed"))}
        </Typography.Paragraph>
      ) : null}
      {saved ? (
        <SettingsSection>
          <SettingsRow
            disclosure={false}
            disabled={busy}
            onPress={() =>
              Alert.alert(t("mobile.server.mcp.removeTitle", { name: saved.name }), t("mobile.server.mcp.removeBody"), [
                { text: t("common.cancel"), style: "cancel" },
                {
                  text: t("mobile.server.mcp.remove"),
                  style: "destructive",
                  onPress: () =>
                    void perform(async () => {
                      removedList.current = await removeMcpServer(saved.id, serverId);
                    }).then((removed) => {
                      if (removed) setLeaving(true);
                    }),
                },
              ])
            }
          >
            <Typography.Paragraph className="text-danger-text">{t("mobile.server.mcp.remove")}</Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      ) : null}
    </SettingsContent>
  );
}
