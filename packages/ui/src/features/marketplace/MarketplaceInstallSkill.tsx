import type { MarketplaceSkillSummary } from "@openbot/contracts/ipc";
import { Button, buttonVariants, Check, ChevronDown, DropdownMenu } from "@openbot/ui";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import { useText } from "@openbot/ui/text";
import { For, Show } from "solid-js";
import { MenuCheck } from "./MarketplaceParts";
import type { MarketplaceAgent } from "./marketplace-model";
import type { MarketplaceScope } from "./marketplace-view";

/** The agents that have the skill, in any state. */
export function skillAgents(scope: MarketplaceScope, skill: MarketplaceSkillSummary): MarketplaceAgent[] {
  return scope.model.agents().filter((agent) => scope.model.installedSkill(agent.id, skill.id));
}

/**
 * The one install control. The button says which agents have the skill. Its menu lists the user's
 * agents, with "All agents" first; a check installs the skill on that agent and a clear removes it.
 */
export function InstallSkill(props: { scope: MarketplaceScope; skill: MarketplaceSkillSummary; emphasis?: boolean }) {
  const { t } = useText();
  const model = () => props.scope.model;
  const have = () => skillAgents(props.scope, props.skill);
  const all = () => have().length > 0 && have().length === model().agents().length;
  const has = (id: string) => have().some((agent) => agent.id === id);
  const label = () => {
    const first = have()[0];
    if (!first) return t("marketplace.skill.installMenu.install");
    if (have().length === 1) return first.name;
    if (all()) return t("marketplace.skill.installMenu.allAgents");
    return t("marketplace.skill.installMenu.agents", { count: have().length });
  };
  const set = (agentIds: readonly string[], on: boolean) => void model().setSkill(props.skill, agentIds, on);
  return (
    <DropdownMenu.Root
      placement="bottom-end"
      gutter={4}
      onOpenChange={(open: boolean) => {
        if (open) model().readSkills();
      }}
    >
      <DropdownMenu.Trigger
        class={`${buttonVariants({
          variant: have().length === 0 && props.emphasis ? "default" : "outline",
          size: props.emphasis ? "default" : "sm",
        })} marketplace-install-trigger`}
        disabled={model().skillBusy(props.skill.id)}
        aria-busy={model().skillBusy(props.skill.id) ? "true" : undefined}
        aria-label={
          have().length === 0
            ? t("marketplace.skill.installMenu.installNamed", { name: props.skill.name })
            : t("marketplace.skill.installMenu.change", {
                count: have().length,
                label: label(),
                name: props.skill.name,
              })
        }
      >
        <Show when={have().length > 0}>
          <Check aria-hidden="true" />
        </Show>
        <span class="marketplace-install-label">{label()}</span>
        <ChevronDown aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="marketplace-menu marketplace-install-menu">
          <DropdownMenu.CheckboxItem
            checked={all()}
            closeOnSelect={false}
            onChange={(on: boolean) =>
              set(
                model()
                  .agents()
                  .filter((agent) => has(agent.id) !== on)
                  .map((agent) => agent.id),
                on,
              )
            }
          >
            <MenuCheck on={all()} />
            {t("marketplace.skill.installMenu.allAgents")}
          </DropdownMenu.CheckboxItem>
          <DropdownMenu.Separator />
          <For each={model().agents()}>
            {(agent) => (
              <DropdownMenu.CheckboxItem
                checked={has(agent.id)}
                closeOnSelect={false}
                onChange={(on: boolean) => set([agent.id], on)}
              >
                <MenuCheck on={has(agent.id)} />
                <span class="marketplace-avatar" data-size="xs">
                  <AgentAvatar agent={agent} motion="idle" />
                </span>
                {agent.name}
                <Show when={agent.id === model().activeAgentId()}>
                  <span class="ui-menu-trailing">{t("marketplace.skill.installMenu.here")}</span>
                </Show>
              </DropdownMenu.CheckboxItem>
            )}
          </For>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/**
 * The skill page action: the install menu, and "Update" beside it while an agent has an older
 * version. The update goes to each of those agents.
 */
export function SkillAction(props: { scope: MarketplaceScope; skill: MarketplaceSkillSummary }) {
  const { t } = useText();
  const model = () => props.scope.model;
  const outdated = () =>
    skillAgents(props.scope, props.skill)
      .filter((agent) => {
        const installed = model().installedSkill(agent.id, props.skill.id);
        /* A modified skill keeps the user's changes: an update would replace them. */
        return (
          installed?.state === "update-available" ||
          (installed?.state === "installed" && installed.installedVersion < props.skill.version)
        );
      })
      .map((agent) => agent.id);
  return (
    <Show when={model().agents().length > 0}>
      <div class="marketplace-head-actions">
        <Show when={outdated().length > 0}>
          <Button
            type="button"
            variant="outline"
            loading={model().skillBusy(props.skill.id)}
            onClick={() => void model().setSkill(props.skill, outdated(), true)}
          >
            {t("marketplace.skill.update")}
          </Button>
        </Show>
        <InstallSkill scope={props.scope} skill={props.skill} emphasis />
      </div>
    </Show>
  );
}
