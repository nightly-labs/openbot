import { router, Stack, useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import Check from "lucide-react-native/icons/check";
import { useState } from "react";
import { useCSSVariable, useUniwind } from "uniwind";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { SettingsSwitch } from "@/features/settings/components/settings-controls";
import { type GitHubPickField, useGitHubAccess } from "@/features/workflows/components/workflow-github-fields";
import { useWorkflowGitHubOptions } from "@/features/workflows/model/use-workflows";
import { draftGraph, useWorkflowDraft } from "@/features/workflows/model/workflow-draft";
import {
  AGENT_CHOOSES,
  githubOutput,
  githubTrigger,
  SAME_REPOSITORY,
} from "@/features/workflows/model/workflow-github";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

const FIELDS: readonly GitHubPickField[] = ["repository", "labels", "person"];

/** Keeps the values that the person chose and the repository no longer lists, before the repository's. */
const withValues = (options: readonly string[], values: readonly string[]) => [
  ...values.filter((value) => !options.includes(value)),
  ...options,
];

/**
 * The editor sheet > a GitHub step > Repository, Labels or Person: a list with a filter. A new
 * repository keeps none of the labels and people of the one before, as on desktop.
 */
export function WorkflowGitHubPickScreen() {
  const { t } = useText();
  const { theme } = useUniwind();
  const accent = String(useCSSVariable("--openbot-accent"));
  const params = useLocalSearchParams<{ nodeId: string; field: string }>();
  const field: GitHubPickField = FIELDS.find((name) => name === params.field) ?? "repository";
  const draft = useWorkflowDraft((state) => state.draft);
  const setFields = useWorkflowDraft((state) => state.setFields);
  const [search, setSearch] = useState("");
  const node = draft?.graph.nodes.find((item) => item.id === params.nodeId);
  const output = node?.kind === "output" && draft ? githubOutput(node, draftGraph(draft)) : null;
  const trigger = node?.kind === "trigger" ? githubTrigger(node) : null;
  const target = output?.target ?? trigger?.repository ?? "";
  const access = useGitHubAccess(draft);
  const options = useWorkflowGitHubOptions(draft?.serverId ?? "", target, access.admin && field !== "repository");
  if (!draft || !node || (!output && !trigger))
    return (
      <SettingsContent>
        <SettingsNote>{t("mobile.workflow.step.gone")}</SettingsNote>
      </SettingsContent>
    );

  const title =
    field === "repository"
      ? t("mobile.workflow.github.repository")
      : field === "person"
        ? t("mobile.workflow.github.output.person")
        : t("mobile.workflow.github.output.labels");
  const query = search.trim().toLowerCase();
  const matches = (values: readonly string[]) =>
    query ? values.filter((value) => value.toLowerCase().includes(query)) : values;
  const check = (on: boolean) => (on ? <Check size={18} color={accent} strokeWidth={2} /> : null);

  const choose = (values: Record<string, string>) => {
    void haptics.selection();
    setFields(node.id, values);
  };
  const chooseOne = (values: Record<string, string>) => {
    choose(values);
    router.back();
  };

  let rows: { value: string; label: string; checked: boolean; onPress: () => void }[];
  let loading = false;
  if (field === "repository") {
    const current = output ? output.repository : (trigger?.repository ?? "");
    const names = access.catalog?.repositories.map((repository) => repository.fullName) ?? [];
    const known = names.some((name) => name.toLowerCase() === current.toLowerCase());
    const list = current && current !== SAME_REPOSITORY && !known ? [current, ...names] : names;
    loading = access.admin && !access.catalog && !access.catalogFailed;
    // Labels and people belong to one repository, so a new repository starts with none.
    const reset: Record<string, string> = output ? { labels: "", person: "" } : { labels: "" };
    rows = [
      ...(output && (output.fromEvent || output.repository === SAME_REPOSITORY) && !query
        ? [
            {
              value: SAME_REPOSITORY,
              label: t("mobile.workflow.github.output.sameRepository"),
              checked: current === SAME_REPOSITORY,
              onPress: () => chooseOne({ repository: SAME_REPOSITORY, ...reset }),
            },
          ]
        : []),
      ...matches(list).map((name) => ({
        value: name,
        label: name,
        checked: name === current,
        onPress: () => chooseOne({ repository: name, ...reset }),
      })),
    ];
  } else if (field === "person") {
    const current = output?.person ?? "";
    const people = withValues(options.data?.people ?? [], current && current !== AGENT_CHOOSES ? [current] : []);
    loading = options.isPending && access.admin;
    rows = [
      ...(!query
        ? [
            {
              value: AGENT_CHOOSES,
              label: t("mobile.workflow.github.output.agentChooses"),
              checked: current === AGENT_CHOOSES,
              onPress: () => chooseOne({ person: AGENT_CHOOSES }),
            },
          ]
        : []),
      ...matches(people).map((login) => ({
        value: login,
        label: `@${login}`,
        checked: login === current,
        onPress: () => chooseOne({ person: login }),
      })),
    ];
  } else {
    const current = output?.labels ?? trigger?.labels ?? [];
    const labels = withValues(options.data?.labels.map((label) => label.name) ?? [], current);
    loading = options.isPending && access.admin;
    rows = matches(labels).map((name) => {
      const checked = current.includes(name);
      return {
        value: name,
        label: name,
        checked,
        onPress: () =>
          choose({ labels: (checked ? current.filter((label) => label !== name) : [...current, name]).join("\n") }),
      };
    });
  }

  const agentLabels = output !== null && field === "labels";
  const agentChooses = output?.labelsFrom === "agent";
  return (
    <SettingsContent>
      <Stack.Screen options={{ title }} />
      {agentLabels ? (
        <SettingsSection footer={t("mobile.workflow.github.output.agentLabelsHint")}>
          <SettingsRow>
            <SettingsSwitch
              value={agentChooses}
              disabled={!access.editable}
              label={t("mobile.workflow.github.output.agentChooses")}
              dark={theme === "dark"}
              onValueChange={(on) => choose({ labelsFrom: on ? "agent" : "list" })}
            />
          </SettingsRow>
        </SettingsSection>
      ) : null}
      {agentLabels && agentChooses ? null : (
        <SheetFormField
          label={t("mobile.workflow.github.filter")}
          hideLabel
          placeholder={t("mobile.workflow.github.filter")}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          value={search}
          onChangeText={setSearch}
        />
      )}
      {agentLabels && agentChooses ? null : rows.length > 0 ? (
        <SettingsSection>
          {rows.map((row) => (
            <SettingsRow
              key={row.value}
              checked={row.checked}
              disclosure={false}
              disabled={!access.editable}
              trailing={check(row.checked)}
              onPress={row.onPress}
            >
              <Typography.Paragraph numberOfLines={1}>{row.label}</Typography.Paragraph>
            </SettingsRow>
          ))}
        </SettingsSection>
      ) : (
        <SettingsNote>
          {loading
            ? t("mobile.workflow.list.loading")
            : query
              ? t("mobile.workflow.github.noMatch", { query: search.trim() })
              : t("mobile.workflow.github.noChoices")}
        </SettingsNote>
      )}
    </SettingsContent>
  );
}
