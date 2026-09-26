import type { AgentTemplateSkill, MarketplaceAgentRoutine } from "@openbot/contracts/ipc";
import type { AppTranslate } from "@openbot/i18n";
import { Button, ChevronDown, ChevronRight, Text } from "@openbot/ui";
import { createSignal, For, Show } from "solid-js";
import { useText } from "../../text";
import { routineScheduleSummary } from "../conversation/routine-schedule-ui";

/** The agent's standing remit: its title and description. */
export function TemplateInstructions(props: { title: string; description: string }) {
  const { t } = useText();
  return (
    <section class="agent-template-section" aria-label={t("agentTemplate.section.instructions")}>
      <Text variant="label" as="strong">
        {t("agentTemplate.section.instructions")}
      </Text>
      <Show when={props.title}>
        <Text variant="body-sm">{props.title}</Text>
      </Show>
      <Text variant="body-sm" tone="secondary" class="agent-template-prose">
        {props.description}
      </Text>
    </section>
  );
}

/**
 * The skills a template carries. With `expandable`, a local skill can open to show the `SKILL.md`
 * text it installs, so a user reads what an agent from another person will follow.
 */
export function TemplateSkills(props: { skills: readonly AgentTemplateSkill[]; expandable?: boolean }) {
  const { t } = useText();
  return (
    <section class="agent-template-section" aria-label={t("agentTemplate.section.skills")}>
      <Text variant="label" as="strong">
        {t("agentTemplate.section.skills")}
      </Text>
      <Show
        when={props.skills.length > 0}
        fallback={
          <Text tone="muted" variant="body-sm">
            {t("agentTemplate.section.noSkills")}
          </Text>
        }
      >
        <ul class="agent-template-list">
          <For each={props.skills}>
            {(skill) => (
              <li>
                <Show
                  when={props.expandable && skill.kind === "embedded" ? skill : null}
                  fallback={
                    <>
                      <Text variant="body-sm">{skill.name}</Text>
                      <Text tone="muted" variant="caption">
                        {skillOrigin(skill, t)}
                      </Text>
                    </>
                  }
                >
                  {(embedded) => <EmbeddedSkill name={embedded().name} markdown={embedded().markdown} />}
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </section>
  );
}

function EmbeddedSkill(props: { name: string; markdown: string }) {
  const { t } = useText();
  const [open, setOpen] = createSignal(false);
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        class="agent-template-skill-toggle"
        aria-expanded={open() ? "true" : "false"}
        onClick={() => setOpen(!open())}
      >
        <Show when={open()} fallback={<ChevronRight aria-hidden="true" />}>
          <ChevronDown aria-hidden="true" />
        </Show>
        {props.name}
      </Button>
      <Text tone="muted" variant="caption">
        {t("agentTemplate.skill.local")}
      </Text>
      <Show when={open()}>
        <pre class="agent-template-skill-text">{props.markdown}</pre>
      </Show>
    </>
  );
}

/** Each routine with its schedule and instruction. `labelled` adds the heading a mixed page needs. */
export function TemplateRoutines(props: { routines: readonly MarketplaceAgentRoutine[]; labelled?: boolean }) {
  const text = useText();
  const { t } = text;
  return (
    <section class="agent-template-section" aria-label={t("agentTemplate.section.routines")}>
      <Show when={props.labelled}>
        <Text variant="label" as="strong">
          {t("agentTemplate.section.routines")}
        </Text>
      </Show>
      <Show
        when={props.routines.length > 0}
        fallback={
          <Text tone="muted" variant="body-sm">
            {t("agentTemplate.section.noRoutines")}
          </Text>
        }
      >
        <ul class="agent-template-list">
          <For each={props.routines}>
            {(routine) => (
              <li>
                <Text variant="body-sm">{routine.name}</Text>
                <Text tone="muted" variant="caption">
                  {routineScheduleSummary(routine.schedule, false, text)}
                  {routine.active ? "" : ` · ${t("agentTemplate.routine.paused")}`}
                </Text>
                <Text tone="secondary" variant="caption" class="agent-template-prose">
                  {routine.instruction}
                </Text>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </section>
  );
}

function skillOrigin(skill: AgentTemplateSkill, t: AppTranslate): string {
  return skill.kind === "marketplace"
    ? t("agentTemplate.skill.marketplace", { version: skill.version })
    : t("agentTemplate.skill.local");
}
