import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { McpServerConfig, McpTestResult, McpTransport } from "@openbot/contracts/ipc";
import { matchingSourceKeys } from "@openbot/i18n/source";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import LogIn from "lucide-react-native/icons/log-in";
import LogOut from "lucide-react-native/icons/log-out";
import PlugZap from "lucide-react-native/icons/plug-zap";
import Trash2 from "lucide-react-native/icons/trash";
import { useEffect, useRef, useState } from "react";
import { Alert, View } from "react-native";
import { useUniwind } from "uniwind";
import { McpAccessSection } from "@/features/servers/components/mcp-access-section";
import { ListField, PairField } from "@/features/servers/components/repeatable-fields";
import { SignInSteps } from "@/features/servers/components/sign-in-steps";
import {
  type McpServerDraft,
  mcpServerConfig,
  mcpServerDraft,
  mcpServerDraftChanged,
  mcpServerDraftErrors,
} from "@/features/servers/model/mcp-server-draft";
import { RELAY_PASTE_PLACEHOLDER, useMcpSignInRelay } from "@/features/servers/model/use-mcp-sign-in-relay";
import { useServerMcp } from "@/features/servers/model/use-server-mcp";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { SettingsPicker, SettingsSwitch } from "@/features/settings/components/settings-controls";
import { RowIcon } from "@/features/settings/components/settings-row-icon";
import {
  useMobileWorkspaceActions,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { SheetSaveAction } from "@/shared/components/sheet-save-action";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import { useDiscardGuard } from "@/shared/lib/use-discard-guard";

const SIGN_IN_ERRORS = new Set([
  "error.backend.mcpSignInRequired",
  "error.backend.mcpSignInOnHost",
  "error.backend.mcpSignInTimedOut",
  "error.backend.mcpSignInRefused",
  "error.mcp.signInOnHost",
]);

const COMMAND_PLACEHOLDER = "openai-dev-mcp";
const WORKING_DIRECTORY_PLACEHOLDER = "~/code";
const URL_PLACEHOLDER = "https://mcp.example.com/mcp";

type TestState = { status: "testing" } | { status: "done"; result: McpTestResult };

function isSignInError(error: string | null | undefined): boolean {
  const key = error ? matchingSourceKeys(error)[0] : undefined;
  return Boolean(key && SIGN_IN_ERRORS.has(key));
}

export function ServerMcpServerScreen() {
  const { t } = useText();
  const { serverId, mcpServerId, signIn } = useLocalSearchParams<{
    serverId: string;
    mcpServerId?: string;
    signIn?: string;
  }>();
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
  return (
    <McpServerForm
      key={saved?.id ?? "new"}
      serverId={serverId}
      saved={saved}
      mcp={mcp}
      signInRequested={signIn === "1"}
    />
  );
}

function McpServerForm({
  serverId,
  saved,
  mcp,
  signInRequested,
}: {
  serverId: string;
  saved: McpServerConfig | undefined;
  mcp: ReturnType<typeof useServerMcp>;
  signInRequested: boolean;
}) {
  const { t, sourceText, errorMessage } = useText();
  const { theme } = useUniwind();
  const { saveMcpServer, removeMcpServer, setMcpServerEnabled, testMcpServer, signOutMcpServer } =
    useMobileWorkspaceActions();
  const { action, perform, setList, setSignIns } = mcp;
  const canRelay = useMobileWorkspaceSelector((workspace) => workspace.canRelayMcpSignIn(serverId));
  const relay = useMcpSignInRelay(serverId);
  const [signingIn, setSigningIn] = useState(false);
  const [address, setAddress] = useState("");
  const [draft, setDraft] = useState<McpServerDraft>(() => mcpServerDraft(saved));
  const [newEnabled, setNewEnabled] = useState(true);
  const [test, setTest] = useState<TestState | null>(null);
  const testRun = useRef(0);
  const [leaving, setLeaving] = useState(false);
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
  const valid = !errors.name && !errors.command && !errors.url && !errors.headers;
  const dirty = mcpServerDraftChanged(draft, saved);
  const signedIn =
    saved?.transport === "http" &&
    Boolean(mcp.signIns.data?.some((state) => state.mcpServerId === saved.id && state.signedIn));
  const testAsksSignIn = test?.status === "done" && isSignInError(test.result.error);
  const showSignIn =
    canRelay && saved?.transport === "http" && !dirty && !signedIn && (signInRequested || testAsksSignIn || signingIn);
  const busy = action.isPending || test?.status === "testing" || signingIn;

  useDiscardGuard((dirty || action.isPending) && !leaving, { busy: () => action.isPending, warn: true });

  function edit(change: Partial<McpServerDraft>) {
    setDraft((current) => ({ ...current, ...change }));
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

  function startSignIn() {
    if (!saved || busy) return;
    setSigningIn(true);
    setAddress("");
    relay
      .signIn(saved)
      .then(async () => {
        if (!relay.mounted.current) return;
        void haptics.notification("success");
        testRun.current += 1;
        setTest(null);
        await mcp.signIns.refetch();
      })
      .catch((cause: unknown) => {
        if (!relay.mounted.current) return;
        void haptics.notification("error");
        relay.setError(errorMessage(cause, t("mobile.marketplace.app.connectFailed")));
      })
      .finally(() => {
        if (relay.mounted.current) setSigningIn(false);
      });
  }

  function testMessage(state: TestState): string {
    if (state.status === "testing") return t("mobile.server.mcp.testing");
    const { error, toolCount } = state.result;
    if (!error) return t("mobile.server.mcp.connected", { count: toolCount });
    if (!isSignInError(error)) return sourceText(error);
    if (showSignIn) return t("mobile.server.mcp.signInHere");
    return matchingSourceKeys(error)[0] === "error.backend.mcpSignInRefused"
      ? sourceText(error)
      : t("mobile.server.mcp.signInOnComputer");
  }

  const relayPage = relay.state.phase === "signIn" ? relay.state : null;

  const locked = action.isPending || signingIn;
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
            footer={errors.headers ? sourceText(errors.headers) : t("mobile.server.mcp.headersHint")}
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
      {saved ? <McpAccessSection serverId={serverId} mcpServerId={saved.id} name={saved.name} /> : null}
      <SettingsSection footer={test ? testMessage(test) : t("mobile.server.mcp.testDescription")}>
        <SettingsRow
          disclosure={false}
          disabled={busy || !valid}
          leading={<RowIcon icon={PlugZap} tone="accent" />}
          onPress={runTest}
        >
          <Typography.Paragraph className="text-accent">
            {test?.status === "testing" ? t("mobile.server.mcp.testing") : t("mobile.server.mcp.test")}
          </Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
      {showSignIn ? (
        <View className="gap-3">
          {relayPage?.paste && saved ? (
            <SettingsSection>
              <SignInSteps
                steps={[
                  t("mobile.marketplace.app.stepOpen", { name: saved.name }),
                  t("mobile.marketplace.app.stepAllow"),
                  t("mobile.marketplace.app.stepBlank"),
                  t("mobile.marketplace.app.stepCopy"),
                  t("mobile.marketplace.app.stepPaste"),
                ]}
              />
            </SettingsSection>
          ) : null}
          <SettingsSection footer={relay.error ?? t("mobile.marketplace.app.signInIntro")}>
            <SettingsRow
              disclosure={false}
              disabled={relayPage ? false : busy}
              leading={<RowIcon icon={LogIn} tone="accent" />}
              onPress={relayPage ? relay.reopen : startSignIn}
            >
              <Typography.Paragraph className="text-accent">
                {relayPage
                  ? t("mobile.marketplace.app.openAgain")
                  : signingIn
                    ? t("mobile.marketplace.app.waiting")
                    : t("mobile.server.mcp.signIn")}
              </Typography.Paragraph>
            </SettingsRow>
          </SettingsSection>
          {relayPage?.paste ? (
            <View className="gap-3">
              <SheetFormField
                label={t("mobile.marketplace.app.pasteLabel")}
                placeholder={RELAY_PASTE_PLACEHOLDER}
                value={address}
                autoCapitalize="none"
                autoCorrect={false}
                inputMode="url"
                onChangeText={setAddress}
              />
              <SettingsSection>
                <SettingsRow
                  disclosure={false}
                  disabled={!address.trim() || relay.pasting}
                  onPress={() => void relay.paste(address)}
                >
                  <Typography.Paragraph className="text-accent">
                    {t("mobile.marketplace.app.finishSignIn")}
                  </Typography.Paragraph>
                </SettingsRow>
              </SettingsSection>
            </View>
          ) : null}
        </View>
      ) : null}
      {signedIn && saved ? (
        <SettingsSection footer={t("mobile.server.mcp.signedInDescription", { server: mcp.server?.name ?? "" })}>
          <SettingsRow
            disclosure={false}
            disabled={busy}
            leading={<RowIcon icon={LogOut} tone="accent" />}
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
            leading={<RowIcon icon={Trash2} tone="danger" />}
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
