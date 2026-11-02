/**
 * The settings of the All workflows page: the GitHub project its issue numbers follow, the colour
 * rules that pick a card's strip, and which plan rings of a local usage feed show. The page owns
 * none of that state — it arrives through props and changes flow back through the change
 * callbacks, so the dialog stays free of app contexts and storage.
 */

import type { AppTextKey } from "@openbot/i18n";
import { Button, Checkbox, Dialog, IconButton, Input, Plus, Trash2, X } from "@openbot/ui";
import { For, Show } from "solid-js";
import { useText } from "../../text";
import { OVERVIEW_TONES, type OverviewTone } from "./WorkflowOverview";

/** One colour rule: a wildcard pattern and the tone a matching card shows. */
export interface OverviewColorRule {
  pattern: string;
  tone: OverviewTone;
}

/** One plan ring of a usage feed, as the settings list it. */
export interface OverviewUsageRow {
  id: string;
  name: string;
  /** What the ring shows, as "5-hour 86% left, Weekly 99% left". */
  summary: string;
}

/** The tone a rule gives, as a key of the tone labels. */
const TONE_LABEL = {
  plan: "workflow.overview.tone.plan",
  build: "workflow.overview.tone.build",
  judge: "workflow.overview.tone.judge",
  conflict: "workflow.overview.tone.conflict",
  violet: "workflow.overview.tone.violet",
} as const satisfies Record<OverviewTone, AppTextKey>;

export function WorkflowOverviewSettings(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The GitHub project the issue numbers follow, "owner/name", or null to follow the helper. */
  project: string | null;
  onProjectChange: (project: string | null) => void;
  /** The project the helper reports, when it answered. */
  reportedProject?: string | null;
  colorRules: readonly OverviewColorRule[];
  onColorRulesChange: (rules: readonly OverviewColorRule[]) => void;
  usageRows: readonly OverviewUsageRow[];
  /** Row ids the user turned off. */
  hiddenUsageRows: readonly string[];
  onHiddenUsageRowsChange: (ids: readonly string[]) => void;
}) {
  const { t } = useText();
  const close = () => props.onOpenChange(false);

  const writeRule = (index: number, pattern: string) => {
    const rules = [...props.colorRules];
    rules[index] = { ...(rules[index] ?? { pattern: "*", tone: "plan" }), pattern };
    props.onColorRulesChange(rules);
  };
  const setTone = (index: number, tone: OverviewTone) => {
    const rules = [...props.colorRules];
    rules[index] = { ...(rules[index] ?? { pattern: "*", tone: "plan" }), tone };
    props.onColorRulesChange(rules);
  };
  const removeRule = (index: number) => {
    const rules = [...props.colorRules];
    rules.splice(index, 1);
    props.onColorRulesChange(rules);
  };
  const addRule = () => {
    const rules = [...props.colorRules, { pattern: "*", tone: props.colorRules.at(-1)?.tone ?? "plan" }];
    props.onColorRulesChange(rules);
  };
  const toggleRow = (id: string, shown: boolean) => {
    const rest = props.hiddenUsageRows.filter((entry) => entry !== id);
    props.onHiddenUsageRowsChange(shown ? rest : [...rest, id]);
  };

  const reported = () =>
    props.reportedProject ? (
      <p class="wfo-settings-hint">
        {t("workflow.overview.settings.projectReported", { project: props.reportedProject })}
      </p>
    ) : null;

  return (
    <Dialog.Root open={props.open} onOpenChange={(open) => (open ? props.onOpenChange(true) : close())}>
      <Dialog.Portal>
        <Dialog.Overlay class="custom-provider-backdrop wfo-settings-backdrop">
          <Dialog.Content as="section" class="custom-provider-dialog wfo-settings-dialog" onCloseAutoFocus={close}>
            <header class="wfo-settings-header">
              <Dialog.Title as="h2" class="wfo-settings-title">
                {t("workflow.overview.settings.title")}
              </Dialog.Title>
              <IconButton label={t("common.close")} variant="ghost" onClick={close}>
                <X aria-hidden="true" />
              </IconButton>
            </header>
            <div class="wfo-settings-body">
              <section class="wfo-settings-section" aria-label={t("workflow.overview.settings.project")}>
                <label class="wfo-settings-label" for="wfo-settings-project">
                  {t("workflow.overview.settings.project")}
                </label>
                <Input
                  id="wfo-settings-project"
                  class="wfo-settings-project"
                  type="text"
                  placeholder={t("workflow.overview.settings.projectPlaceholder")}
                  autocomplete="off"
                  spellcheck={false}
                  value={props.project ?? ""}
                  onValueChange={(value) => props.onProjectChange(value.trim() === "" ? null : value.trim())}
                />
                <p class="wfo-settings-hint">{t("workflow.overview.settings.projectHint")}</p>
                {reported()}
              </section>
              <section class="wfo-settings-section" aria-label={t("workflow.overview.settings.colors")}>
                <span class="wfo-settings-label">{t("workflow.overview.settings.colors")}</span>
                <p class="wfo-settings-hint">{t("workflow.overview.settings.colorsHint")}</p>
                <For each={props.colorRules}>
                  {(rule, index) => (
                    <div class="wfo-settings-rule">
                      <Input
                        class="wfo-settings-pattern"
                        type="text"
                        placeholder={t("workflow.overview.settings.patternPlaceholder")}
                        autocomplete="off"
                        spellcheck={false}
                        value={rule.pattern}
                        onValueChange={(value) => writeRule(index(), value)}
                      />
                      <Show when={rule.pattern.trim() === ""}>
                        <span class="wfo-settings-rule-error" role="alert">
                          {t("workflow.overview.settings.patternEmpty")}
                        </span>
                      </Show>
                      <Button
                        variant="ghost"
                        size="sm"
                        class="wfo-settings-swatch"
                        data-tone={rule.tone}
                        aria-label={t("workflow.overview.settings.toneOf", {
                          tone: t(TONE_LABEL[rule.tone]),
                        })}
                        title={t(TONE_LABEL[rule.tone])}
                        onClick={() =>
                          setTone(
                            index(),
                            OVERVIEW_TONES[(OVERVIEW_TONES.indexOf(rule.tone) + 1) % OVERVIEW_TONES.length] ??
                              rule.tone,
                          )
                        }
                      >
                        <span class="wfo-settings-swatch-dot" aria-hidden="true" />
                      </Button>
                      <IconButton
                        label={t("workflow.overview.settings.removeRule", { number: index() + 1 })}
                        variant="ghost"
                        onClick={() => removeRule(index())}
                      >
                        <Trash2 aria-hidden="true" />
                      </IconButton>
                    </div>
                  )}
                </For>
                <Button variant="outline" size="sm" class="wfo-settings-add" onClick={addRule}>
                  <Plus aria-hidden="true" />
                  {t("workflow.overview.settings.addRule")}
                </Button>
              </section>
              <section class="wfo-settings-section" aria-label={t("workflow.overview.settings.usage")}>
                <span class="wfo-settings-label">{t("workflow.overview.settings.usage")}</span>
                <p class="wfo-settings-hint">{t("workflow.overview.settings.usageHint")}</p>
                <Show
                  when={props.usageRows.length > 0}
                  fallback={<p class="wfo-settings-hint">{t("workflow.overview.settings.usageNone")}</p>}
                >
                  <For each={props.usageRows}>
                    {(row) => (
                      <label class="wfo-settings-row" for={`wfo-settings-usage-${row.id}`}>
                        <Checkbox
                          id={`wfo-settings-usage-${row.id}`}
                          checked={!props.hiddenUsageRows.includes(row.id)}
                          onChange={(event) => toggleRow(row.id, event.currentTarget.checked)}
                        />
                        <span class="wfo-settings-row-name">{row.name}</span>
                        <span class="wfo-settings-row-summary">{row.summary}</span>
                      </label>
                    )}
                  </For>
                </Show>
              </section>
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
