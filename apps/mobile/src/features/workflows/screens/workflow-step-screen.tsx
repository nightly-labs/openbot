import { type AgentReasoningEffort, canAdministerServer, type WorkflowNode } from "@openbot/contracts/ipc";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { useQuery } from "@tanstack/react-query";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import Check from "lucide-react-native/icons/check";
import { Alert } from "react-native";
import { useCSSVariable, useUniwind } from "uniwind";
import { BloubAvatar } from "@/features/agents/components/bloub-avatar";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { SettingsPicker } from "@/features/settings/components/settings-controls";
import { DiscordOutputFields } from "@/features/workflows/components/workflow-discord-fields";
import { GitHubOutputFields } from "@/features/workflows/components/workflow-github-fields";
import { TelegramOutputFields } from "@/features/workflows/components/workflow-telegram-fields";
import { useWorkflowGitHubSupported } from "@/features/workflows/model/use-workflows";
import { useWorkflowDraft, type WorkflowDraft } from "@/features/workflows/model/workflow-draft";
import { GITHUB_OUTPUT_DEFAULTS } from "@/features/workflows/model/workflow-github";
import { canMove, outlineListOf } from "@/features/workflows/model/workflow-outline";
import { draftProblems } from "@/features/workflows/model/workflow-problems";
import { kindLabel } from "@/features/workflows/model/workflow-steps";
import {
  useMobileWorkspaceActions,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import type { MobileAgent } from "@/features/workspace/model/workspace-types";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { haptics } from "@/shared/lib/haptics";
import { currentText, useText } from "@/shared/lib/text";
import { typeScale } from "@/shared/lib/type-scale";

const EFFORT_LABEL = {
  none: "mobile.agent.runtime.effort.none",
  minimal: "mobile.agent.runtime.effort.minimal",
  low: "mobile.agent.runtime.effort.low",
  medium: "mobile.agent.runtime.effort.medium",
  high: "mobile.agent.runtime.effort.high",
  xhigh: "mobile.agent.runtime.effort.xhigh",
  max: "mobile.agent.runtime.effort.max",
  ultra: "mobile.agent.runtime.effort.ultra",
} as const satisfies Record<AgentReasoningEffort, MobileTextKey>;

/** The longest text of a field that `workflows-v1` carries. */
const FIELD_LIMIT = 20_000;

const text = (node: WorkflowNode, name: string) => {
  const value = node.fields[name];
  return typeof value === "string" ? value : "";
};

/** The text of a step: its task, prompt, question or text, in one field. */
function TextField({
  node,
  name,
  label,
  placeholder,
}: {
  node: WorkflowNode;
  name: string;
  label: string;
  placeholder: string;
}) {
  const setFields = useWorkflowDraft((state) => state.setFields);
  return (
    <SheetFormField
      label={label}
      multiline
      maxLength={FIELD_LIMIT}
      autoCapitalize="sentences"
      placeholder={placeholder}
      value={text(node, name)}
      onChangeText={(value) => setFields(node.id, { [name]: value })}
    />
  );
}

/** The agents of the server, one of which does an agent step. */
function AgentChoice({ node, agents }: { node: WorkflowNode; agents: readonly MobileAgent[] }) {
  const { t } = useText();
  const accent = String(useCSSVariable("--openbot-accent"));
  const setFields = useWorkflowDraft((state) => state.setFields);
  const selected = text(node, "agentId");
  return (
    <SettingsSection
      title={t("mobile.workflow.step.agent")}
      footer={agents.length === 0 ? t("mobile.workflow.step.noAgents") : t("mobile.workflow.step.agentHint")}
    >
      {agents.map((agent) => (
        <SettingsRow
          key={agent.id}
          checked={agent.id === selected}
          disclosure={false}
          leading={
            <BloubAvatar
              agentId={agent.id}
              serverId={agent.serverId}
              hue={agent.avatarHue}
              seed={agent.avatarSeed}
              size={30}
              animateIdle={false}
            />
          }
          trailing={agent.id === selected ? <Check size={18} color={accent} strokeWidth={2} /> : null}
          onPress={() => {
            void haptics.selection();
            setFields(node.id, { agentId: agent.id });
          }}
        >
          <Typography.Paragraph numberOfLines={1}>{agent.name}</Typography.Paragraph>
        </SettingsRow>
      ))}
    </SettingsSection>
  );
}

/**
 * The model of a model step and its effort. Without a model, the host uses its preferred model, as
 * the desktop does for a step whose model is gone.
 */
function ModelChoice({ node, serverId }: { node: WorkflowNode; serverId: string }) {
  const { t } = useText();
  const { theme } = useUniwind();
  const queryScope = useQueryScope();
  const { loadAgentModels } = useMobileWorkspaceActions();
  const setFields = useWorkflowDraft((state) => state.setFields);
  const models = useQuery({
    queryKey: queryKeys.agentModels(queryScope, serverId),
    queryFn: () => loadAgentModels(serverId),
    retry: false,
  });
  const provider = text(node, "provider");
  const model = text(node, "model");
  const value = provider && model ? `${provider}:${model}` : "";
  const options = models.data ?? [];
  const current = options.find((option) => option.provider === provider && option.id === model);
  const efforts = current && current.reasoningEffortConfigurable !== false ? current.supportedReasoningEfforts : [];
  const effort = text(node, "effort") || current?.defaultReasoningEffort || "";
  return (
    <SettingsSection
      title={t("mobile.workflow.step.model")}
      footer={models.isError ? t("mobile.workflow.step.modelsFailed") : undefined}
    >
      <SettingsRow
        trailing={
          <SettingsPicker<string>
            value={value}
            enabled={!models.isPending}
            dark={theme === "dark"}
            label={t("mobile.workflow.step.model")}
            options={[
              { value: "", label: t("mobile.workflow.step.defaultModel") },
              // A model that the host does not list now stays a choice, so the picker shows it.
              ...(value && !current ? [{ value, label: model }] : []),
              ...options.map((option) => ({ value: `${option.provider}:${option.id}`, label: option.name })),
            ]}
            onChange={(next) => {
              const chosen = options.find((option) => `${option.provider}:${option.id}` === next);
              setFields(
                node.id,
                chosen
                  ? { provider: chosen.provider, model: chosen.id, effort: chosen.defaultReasoningEffort }
                  : { provider: undefined, model: undefined, effort: undefined },
              );
            }}
          />
        }
      >
        <Typography.Paragraph>{t("mobile.workflow.step.model")}</Typography.Paragraph>
      </SettingsRow>
      {efforts.length > 1 ? (
        <SettingsRow
          trailing={
            <SettingsPicker<string>
              value={effort}
              enabled
              dark={theme === "dark"}
              label={t("mobile.workflow.step.effort")}
              options={efforts.map((option) => ({ value: option, label: t(EFFORT_LABEL[option]) }))}
              onChange={(next) => setFields(node.id, { effort: next })}
            />
          }
        >
          <Typography.Paragraph>{t("mobile.workflow.step.effort")}</Typography.Paragraph>
        </SettingsRow>
      ) : null}
    </SettingsSection>
  );
}

const SHOWN_TARGET_LABEL = {
  channel: "mobile.workflow.output.channel",
  file: "mobile.workflow.output.file",
  discord: "mobile.workflow.output.discord",
  telegram: "mobile.workflow.output.telegram",
  slack: "mobile.workflow.output.slack",
} as const satisfies Record<string, MobileTextKey>;

/**
 * Where an output sends its result. The phone does not choose a messaging place, a Discord server or a
 * Telegram chat: only the computer that runs OpenBot has them. An owner or admin adds a GitHub output, on a host that
 * runs it, as on desktop.
 */
function OutputChoice({ node, draft }: { node: WorkflowNode; draft: WorkflowDraft }) {
  const { t } = useText();
  const accent = String(useCSSVariable("--openbot-accent"));
  const setFields = useWorkflowDraft((state) => state.setFields);
  const admin = useMobileWorkspaceSelector((current) =>
    canAdministerServer(current.servers.find((server) => server.id === draft.serverId)?.role),
  );
  const githubSupported = useWorkflowGitHubSupported(draft.serverId);
  const target = text(node, "target");
  const shown =
    target === "channel" || target === "file" || target === "discord" || target === "telegram" || target === "slack"
      ? target
      : null;
  const notify = shown === null && target !== "github";
  const check = (on: boolean) => (on ? <Check size={18} color={accent} strokeWidth={2} /> : null);
  const choose = (next: "notify" | "github") => {
    if (next === target || (next === "notify" && notify)) return;
    void haptics.selection();
    // A Discord, Telegram or Slack output also keeps an `action`, so a change from it writes the GitHub defaults
    // again.
    if (next === "github")
      setFields(node.id, {
        target: "github",
        ...(node.fields.action === undefined || target === "discord" || target === "telegram" || target === "slack"
          ? GITHUB_OUTPUT_DEFAULTS
          : {}),
      });
    else setFields(node.id, { target: "notify", connectionId: undefined, placeId: undefined });
  };
  return (
    <SettingsSection
      title={t("mobile.workflow.step.sendTo")}
      footer={target === "channel" ? t("mobile.workflow.step.channelHint") : undefined}
    >
      <SettingsRow checked={notify} disclosure={false} trailing={check(notify)} onPress={() => choose("notify")}>
        <Typography.Paragraph>{t("mobile.workflow.output.notify")}</Typography.Paragraph>
      </SettingsRow>
      {(admin && githubSupported) || target === "github" ? (
        <SettingsRow
          checked={target === "github"}
          disclosure={false}
          disabled={!admin}
          supportingText={t("mobile.workflow.output.githubHint")}
          trailing={check(target === "github")}
          onPress={() => choose("github")}
        >
          <Typography.Paragraph>{t("mobile.workflow.output.github")}</Typography.Paragraph>
        </SettingsRow>
      ) : null}
      {shown ? (
        <SettingsRow checked disclosure={false} trailing={check(true)}>
          <Typography.Paragraph>{t(SHOWN_TARGET_LABEL[shown])}</Typography.Paragraph>
        </SettingsRow>
      ) : null}
    </SettingsSection>
  );
}

/** The editor sheet > a step: its settings, and where it goes in the workflow. */
export function WorkflowStepScreen() {
  const { t } = useText();
  const { nodeId } = useLocalSearchParams<{ nodeId: string }>();
  const draft = useWorkflowDraft((state) => state.draft);
  const { move, duplicate, remove, connect } = useWorkflowDraft.getState();
  const agents = useMobileWorkspaceSelector((current) => current.agents);
  const node = draft?.graph.nodes.find((item) => item.id === nodeId);
  if (!draft || !node)
    return (
      <SettingsContent>
        <SettingsNote>{t("mobile.workflow.step.gone")}</SettingsNote>
      </SettingsContent>
    );
  const serverAgents = agents.filter((agent) => agent.serverId === draft.serverId);
  const outline = draft.mode === "outline" ? draft.outline : null;
  const list = outline ? outlineListOf(outline, node.id) : null;
  const problem = draftProblems(draft, serverAgents, t).steps.get(node.id);
  const loose = list === "loose";

  const removeStep = () => {
    const text = currentText();
    const deleteNow = () => {
      remove(node.id);
      router.back();
    };
    if (node.kind !== "condition") {
      void haptics.selection();
      deleteNow();
      return;
    }
    const count = outline ? outline.yes.length + outline.no.length : 0;
    Alert.alert(
      text.t("mobile.workflow.editor.deleteConditionTitle"),
      count > 0
        ? text.t("mobile.workflow.editor.deleteConditionPaths", { count })
        : text.t("mobile.workflow.editor.deleteConditionBody"),
      [
        { text: text.t("common.cancel"), style: "cancel" },
        { text: text.t("mobile.workflow.editor.delete"), style: "destructive", onPress: deleteNow },
      ],
    );
  };

  return (
    <SettingsContent>
      <Stack.Screen options={{ title: kindLabel(node.kind, t) }} />
      {problem ? (
        <Typography.Paragraph className="px-4 font-medium text-danger-text" style={typeScale.caption}>
          {problem}
        </Typography.Paragraph>
      ) : null}
      {node.kind === "agent" ? (
        <>
          <AgentChoice node={node} agents={serverAgents} />
          <TextField
            node={node}
            name="task"
            label={t("mobile.workflow.step.task")}
            placeholder={t("mobile.workflow.step.taskDefault")}
          />
        </>
      ) : null}
      {node.kind === "llm" ? (
        <>
          <ModelChoice node={node} serverId={draft.serverId} />
          <TextField
            node={node}
            name="prompt"
            label={t("mobile.workflow.step.prompt")}
            placeholder={t("mobile.workflow.step.promptDefault")}
          />
        </>
      ) : null}
      {node.kind === "condition" ? (
        <>
          <TextField
            node={node}
            name="rule"
            label={t("mobile.workflow.step.rule")}
            placeholder={t("mobile.workflow.step.ruleDefault")}
          />
          <SettingsNote>{t("mobile.workflow.step.ruleHint")}</SettingsNote>
        </>
      ) : null}
      {node.kind === "approval" ? (
        <>
          <TextField
            node={node}
            name="question"
            label={t("mobile.workflow.step.question")}
            placeholder={t("mobile.workflow.step.questionDefault")}
          />
          <SettingsNote>{t("mobile.workflow.step.questionHint")}</SettingsNote>
        </>
      ) : null}
      {node.kind === "prompt" ? (
        <TextField
          node={node}
          name="text"
          label={t("mobile.workflow.step.text")}
          placeholder={t("mobile.workflow.step.textPlaceholder")}
        />
      ) : null}
      {node.kind === "output" ? (
        <>
          <OutputChoice node={node} draft={draft} />
          {text(node, "target") === "github" ? <GitHubOutputFields node={node} draft={draft} /> : null}
          {text(node, "target") === "discord" ? <DiscordOutputFields node={node} /> : null}
          {text(node, "target") === "telegram" ? <TelegramOutputFields node={node} /> : null}
        </>
      ) : null}
      {outline && (list || node.kind === "condition") ? (
        <SettingsSection>
          {list && canMove(outline, node.id, -1) ? (
            <SettingsRow disclosure={false} onPress={() => move(node.id, -1)}>
              <Typography.Paragraph>{t("mobile.workflow.editor.moveUp")}</Typography.Paragraph>
            </SettingsRow>
          ) : null}
          {list && canMove(outline, node.id, 1) ? (
            <SettingsRow disclosure={false} onPress={() => move(node.id, 1)}>
              <Typography.Paragraph>{t("mobile.workflow.editor.moveDown")}</Typography.Paragraph>
            </SettingsRow>
          ) : null}
          {loose && node.kind !== "condition" ? (
            <SettingsRow
              disclosure={false}
              onPress={() => {
                connect(node.id);
                router.back();
              }}
            >
              <Typography.Paragraph>{t("mobile.workflow.editor.connect")}</Typography.Paragraph>
            </SettingsRow>
          ) : null}
          {list && !loose ? (
            <SettingsRow
              disclosure={false}
              onPress={() => {
                duplicate(node.id);
                router.back();
              }}
            >
              <Typography.Paragraph>{t("mobile.workflow.editor.duplicate")}</Typography.Paragraph>
            </SettingsRow>
          ) : null}
          <SettingsRow disclosure={false} onPress={removeStep}>
            <Typography.Paragraph className="text-danger-text">
              {t("mobile.workflow.editor.delete")}
            </Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      ) : null}
    </SettingsContent>
  );
}
