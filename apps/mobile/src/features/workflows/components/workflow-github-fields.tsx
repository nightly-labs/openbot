import {
  canAdministerServer,
  WORKFLOW_GITHUB_ACTIONS,
  WORKFLOW_GITHUB_EVENTS,
  type WorkflowGitHubAction,
  type WorkflowGitHubCatalog,
  type WorkflowGitHubEvent,
  type WorkflowGitHubFilter,
  type WorkflowNode,
} from "@openbot/contracts/ipc";
import { router } from "expo-router";
import { Typography } from "heroui-native";
import { useUniwind } from "uniwind";
import { SettingsNote, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { SettingsPicker, SettingsSwitch } from "@/features/settings/components/settings-controls";
import { useWorkflowGitHubCatalog } from "@/features/workflows/model/use-workflows";
import { draftGraph, useWorkflowDraft, type WorkflowDraft } from "@/features/workflows/model/workflow-draft";
import {
  AGENT_CHOOSES,
  GITHUB_ACCESS_LABEL,
  GITHUB_ACTION_LABEL,
  GITHUB_EVENT_LABEL,
  GITHUB_FILTER_LABEL,
  GITHUB_REASON_LABEL,
  type GitHubOutputItem,
  githubAccessProblem,
  githubOutput,
  githubTrigger,
  isPullRequestAction,
  SAME_REPOSITORY,
} from "@/features/workflows/model/workflow-github";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

/** Words that the title of a pull request or issue contains. */
const TITLE_PLACEHOLDER = "fix:";

/** The longest text of a filter field that `workflows-v1` carries. */
const FILTER_LIMIT = 200;

export type GitHubPickField = "repository" | "labels" | "person";

/** Opens the list of repositories, labels or people of a GitHub step. */
function openGitHubPick(nodeId: string, field: GitHubPickField) {
  router.push({ pathname: "/workflow-editor/github-pick", params: { nodeId, field } });
}

/**
 * Who may change a GitHub step on this server, and the host's GitHub connection. The host takes a
 * change of a GitHub step only from an owner or admin, and gives the catalog only to them.
 */
export function useGitHubAccess(draft: Pick<WorkflowDraft, "serverId" | "mode"> | null) {
  const serverId = draft?.serverId ?? "";
  const admin = useMobileWorkspaceSelector((current) =>
    canAdministerServer(current.servers.find((server) => server.id === serverId)?.role),
  );
  const catalog = useWorkflowGitHubCatalog(serverId, admin);
  return {
    admin,
    catalog: catalog.data,
    catalogFailed: catalog.isError,
    editable: admin && draft !== null && draft.mode !== "read-only",
  };
}

/** A note that tells why the person cannot change the step, or what GitHub needs. */
function GitHubNotes({
  admin,
  catalog,
  catalogFailed,
  repository,
  need,
}: {
  admin: boolean;
  catalog: WorkflowGitHubCatalog | undefined;
  catalogFailed: boolean;
  repository: string;
  need: { write: boolean; events: boolean };
}) {
  const { t } = useText();
  if (!admin) return <SettingsNote>{t("mobile.workflow.github.adminOnly")}</SettingsNote>;
  if (catalogFailed) return <SettingsNote>{t("mobile.workflow.github.catalogFailed")}</SettingsNote>;
  if (catalog && !catalog.connected) return <SettingsNote>{t("mobile.workflow.github.notConnected")}</SettingsNote>;
  const problem = githubAccessProblem(catalog, repository, need);
  return problem ? (
    <Typography.Paragraph className="px-4 font-medium text-warning-text" type="body-xs">
      {t(GITHUB_ACCESS_LABEL[problem], { repository })}
    </Typography.Paragraph>
  ) : null;
}

function PickRow({
  label,
  value,
  disabled,
  onPress,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <SettingsRow
      disabled={disabled}
      onPress={onPress}
      trailing={
        <Typography.Paragraph className="text-grouped-secondary" numberOfLines={1}>
          {value}
        </Typography.Paragraph>
      }
    >
      <Typography.Paragraph>{label}</Typography.Paragraph>
    </SettingsRow>
  );
}

/** The settings of a GitHub trigger: its repository, its event, its labels and its filters. */
export function GitHubTriggerFields({ node, draft }: { node: WorkflowNode; draft: WorkflowDraft }) {
  const { t } = useText();
  const { theme } = useUniwind();
  const setFields = useWorkflowDraft((state) => state.setFields);
  const access = useGitHubAccess(draft);
  const settings = githubTrigger(node);
  const editable = access.editable;
  const labelsName =
    settings.event === "issue.labeled"
      ? t("mobile.workflow.github.trigger.labelAdded")
      : t("mobile.workflow.github.trigger.hasLabel");
  const setFilter = (filter: WorkflowGitHubFilter, on: boolean) => {
    void haptics.selection();
    const next = on ? [...settings.filters, filter] : settings.filters.filter((value) => value !== filter);
    setFields(node.id, { filters: next.join("\n") });
  };
  return (
    <>
      <SettingsSection title={t("mobile.workflow.trigger.github")}>
        <PickRow
          label={t("mobile.workflow.github.repository")}
          value={settings.repository || t("mobile.workflow.github.chooseRepository")}
          disabled={!editable}
          onPress={() => openGitHubPick(node.id, "repository")}
        />
        <SettingsRow
          trailing={
            <SettingsPicker<WorkflowGitHubEvent>
              value={settings.event}
              enabled={editable}
              dark={theme === "dark"}
              label={t("mobile.workflow.github.trigger.event")}
              options={WORKFLOW_GITHUB_EVENTS.map((event) => ({ value: event, label: t(GITHUB_EVENT_LABEL[event]) }))}
              onChange={(event) => setFields(node.id, { event })}
            />
          }
        >
          <Typography.Paragraph>{t("mobile.workflow.github.trigger.event")}</Typography.Paragraph>
        </SettingsRow>
        <PickRow
          label={labelsName}
          value={settings.labels.length > 0 ? settings.labels.join(", ") : t("mobile.workflow.github.trigger.anyLabel")}
          disabled={!editable || !settings.repository}
          onPress={() => openGitHubPick(node.id, "labels")}
        />
      </SettingsSection>
      <SettingsSection
        title={t("mobile.workflow.github.trigger.onlyWhen")}
        footer={settings.filters.length === 0 ? t("mobile.workflow.github.trigger.always") : undefined}
      >
        {settings.filterOptions.map((filter) => (
          <SettingsRow key={filter}>
            <SettingsSwitch
              value={settings.filters.includes(filter)}
              disabled={!editable}
              label={t(GITHUB_FILTER_LABEL[filter])}
              dark={theme === "dark"}
              onValueChange={(on) => setFilter(filter, on)}
            />
          </SettingsRow>
        ))}
      </SettingsSection>
      {settings.filters.includes("title") ? (
        <SheetFormField
          label={t("mobile.workflow.github.trigger.titleHas")}
          placeholder={TITLE_PLACEHOLDER}
          value={settings.titleText}
          maxLength={FILTER_LIMIT}
          editable={editable}
          onChangeText={(titleText) => setFields(node.id, { titleText })}
        />
      ) : null}
      {settings.filters.includes("branch") ? (
        <SheetFormField
          label={t("mobile.workflow.github.trigger.baseBranch")}
          placeholder={t("mobile.workflow.github.trigger.baseBranchPlaceholder")}
          value={settings.branch}
          maxLength={FILTER_LIMIT}
          autoCapitalize="none"
          autoCorrect={false}
          editable={editable}
          onChangeText={(branch) => setFields(node.id, { branch })}
        />
      ) : null}
      <GitHubNotes
        admin={access.admin}
        catalog={access.catalog}
        catalogFailed={access.catalogFailed}
        repository={settings.repository}
        need={{ write: false, events: true }}
      />
    </>
  );
}

/** The settings of a GitHub output: the repository, the item, the action and what the action needs. */
export function GitHubOutputFields({ node, draft }: { node: WorkflowNode; draft: WorkflowDraft }) {
  const { t } = useText();
  const { theme } = useUniwind();
  const setFields = useWorkflowDraft((state) => state.setFields);
  const access = useGitHubAccess(draft);
  const settings = githubOutput(node, draftGraph(draft));
  const editable = access.editable;
  const actionLabel = (action: WorkflowGitHubAction) => t(GITHUB_ACTION_LABEL[action]);
  const items: { value: GitHubOutputItem; label: string }[] = [
    ...(settings.fromEvent || settings.item === "event"
      ? [{ value: "event" as const, label: t("mobile.workflow.github.output.sameItem") }]
      : []),
    { value: "input", label: t("mobile.workflow.github.output.numberInInput") },
  ];
  const actions = WORKFLOW_GITHUB_ACTIONS.filter(
    (action) => action === settings.action || !(settings.issuesOnly && isPullRequestAction(action)),
  );
  const repositoryValue =
    settings.repository === SAME_REPOSITORY ? t("mobile.workflow.github.output.sameRepository") : settings.repository;
  const personValue =
    settings.person === AGENT_CHOOSES
      ? t("mobile.workflow.github.output.agentChooses")
      : settings.person
        ? `@${settings.person}`
        : t("mobile.workflow.github.output.choosePerson");
  const labelsValue =
    settings.labelsFrom === "agent"
      ? t("mobile.workflow.github.output.agentChooses")
      : settings.labels.length > 0
        ? settings.labels.join(", ")
        : t("mobile.workflow.github.output.none");
  return (
    <>
      <SettingsSection title={t("mobile.workflow.output.github")}>
        <PickRow
          label={t("mobile.workflow.github.repository")}
          value={repositoryValue}
          disabled={!editable}
          onPress={() => openGitHubPick(node.id, "repository")}
        />
        {settings.creates ? null : (
          <SettingsRow
            trailing={
              <SettingsPicker<GitHubOutputItem>
                value={settings.item}
                enabled={editable}
                dark={theme === "dark"}
                label={t("mobile.workflow.github.output.on")}
                options={items}
                onChange={(item) => setFields(node.id, { item })}
              />
            }
          >
            <Typography.Paragraph>{t("mobile.workflow.github.output.on")}</Typography.Paragraph>
          </SettingsRow>
        )}
        <SettingsRow
          trailing={
            <SettingsPicker<WorkflowGitHubAction>
              value={settings.action}
              enabled={editable}
              dark={theme === "dark"}
              label={t("mobile.workflow.github.output.action")}
              options={actions.map((action) => ({ value: action, label: actionLabel(action) }))}
              onChange={(action) => setFields(node.id, { action })}
            />
          }
        >
          <Typography.Paragraph>{t("mobile.workflow.github.output.action")}</Typography.Paragraph>
        </SettingsRow>
        {settings.usesLabels ? (
          <PickRow
            label={t("mobile.workflow.github.output.labels")}
            value={labelsValue}
            disabled={!editable || !settings.target}
            onPress={() => openGitHubPick(node.id, "labels")}
          />
        ) : null}
        {settings.usesPerson ? (
          <PickRow
            label={t("mobile.workflow.github.output.person")}
            value={personValue}
            disabled={!editable || !settings.target}
            onPress={() => openGitHubPick(node.id, "person")}
          />
        ) : null}
        {settings.hasReason ? (
          <SettingsRow
            trailing={
              <SettingsPicker
                value={settings.reason}
                enabled={editable}
                dark={theme === "dark"}
                label={t("mobile.workflow.github.output.reason")}
                options={(["completed", "notPlanned"] as const).map((reason) => ({
                  value: reason,
                  label: t(GITHUB_REASON_LABEL[reason]),
                }))}
                onChange={(reason) => setFields(node.id, { reason })}
              />
            }
          >
            <Typography.Paragraph>{t("mobile.workflow.github.output.reason")}</Typography.Paragraph>
          </SettingsRow>
        ) : null}
      </SettingsSection>
      {settings.creates ? (
        <SheetFormField
          label={t("mobile.workflow.github.output.title")}
          placeholder={t("mobile.workflow.github.output.titlePlaceholder")}
          value={settings.title}
          maxLength={FILTER_LIMIT}
          autoCapitalize="sentences"
          editable={editable}
          onChangeText={(title) => setFields(node.id, { title })}
        />
      ) : null}
      {settings.noEvent ? (
        <Typography.Paragraph className="px-4 font-medium text-warning-text" type="body-xs">
          {t("mobile.workflow.github.alert.noEvent")}
        </Typography.Paragraph>
      ) : null}
      {settings.pullRequestOnly ? (
        <Typography.Paragraph className="px-4 font-medium text-warning-text" type="body-xs">
          {t("mobile.workflow.github.alert.pullRequestOnly", { action: actionLabel(settings.action) })}
        </Typography.Paragraph>
      ) : null}
      <GitHubNotes
        admin={access.admin}
        catalog={access.catalog}
        catalogFailed={access.catalogFailed}
        repository={settings.target}
        need={{ write: true, events: false }}
      />
    </>
  );
}
