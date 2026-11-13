import { Button, Dialog, IconButton, X } from "@openbot/ui";
import { createSignal, createStore, Show } from "solid-js";
import { useText } from "../../text";
import { AgentSearchList, AgentStack } from "../marketplace/MarketplaceAgentsDialog";
import type { MarketplaceAgent } from "../marketplace/marketplace-model";

/** An agent that a Vault item can be for. */
export type VaultAgentChoice = MarketplaceAgent;

/** The agents of an item: null is every agent, also each agent that is added later. */
export type VaultAgentScope = readonly string[] | null;

const allows = (scope: VaultAgentScope, agentId: string) => scope === null || scope.includes(agentId);

/** Chooses the agents of one item, with a search. The change waits for Save. */
function VaultAgentsDialog(props: {
  name: string;
  agents: readonly VaultAgentChoice[];
  scope: VaultAgentScope;
  onSave: (scope: VaultAgentScope) => void;
  onClose: () => void;
}) {
  const { t } = useText();
  const [draft, setDraft] = createStore<{ on: Record<string, boolean> }>({ on: {} });
  const checked = (agentId: string) => draft.on[agentId] ?? allows(props.scope, agentId);
  const chosen = () => props.agents.filter((agent) => checked(agent.id)).map((agent) => agent.id);
  const unchanged = () => props.agents.every((agent) => checked(agent.id) === allows(props.scope, agent.id));
  const save = () => {
    const on = chosen();
    // Each agent chosen is every agent, so an agent that is added later can use the item too.
    props.onSave(on.length === props.agents.length ? null : on);
    props.onClose();
  };
  let content: HTMLElement | undefined;
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay class="integration-dialog-backdrop" data-nested="" />
        <Dialog.Content
          class="integration-wizard integration-wizard-dialog marketplace-skill-agents-dialog"
          data-nested=""
          as="section"
          ref={(element) => {
            content = element;
          }}
          // The dialog opens on the agent search, not on Close.
          onOpenAutoFocus={(event) => {
            const search = content?.querySelector<HTMLElement>("input[type=search]");
            if (!search) return;
            event.preventDefault();
            search.focus({ preventScroll: true });
          }}
        >
          <header class="marketplace-skill-dialog-head">
            <Dialog.Title as="h2" class="ui-heading" data-size="md" data-tone="primary">
              {props.name}
            </Dialog.Title>
            <IconButton label={t("common.close")} variant="ghost" onClick={props.onClose}>
              <X />
            </IconButton>
          </header>
          <form
            class="integration-wizard-form"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <div class="integration-wizard-body">
              <AgentSearchList
                agents={props.agents}
                label={t("vault.agents.list", { name: props.name })}
                checked={checked}
                set={(agents, on) =>
                  setDraft((state) => {
                    for (const agent of agents) state.on[agent.id] = on;
                  })
                }
                blocked={() => false}
                note={() => undefined}
              />
            </div>
            <div class="integration-wizard-foot">
              <Button type="button" variant="ghost" onClick={props.onClose}>
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                class="marketplace-skill-dialog-submit"
                disabled={unchanged() || chosen().length === 0}
              >
                {t("common.save")}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * The faces and the summary of the agents of one item: "All agents", one agent's name, or "3 of 50".
 * It opens the agents dialog. An id of an agent that the server no longer has does not count.
 */
export function VaultAgentsButton(props: {
  name: string;
  agents: readonly VaultAgentChoice[];
  scope: VaultAgentScope;
  disabled?: boolean | undefined;
  onChange: (scope: VaultAgentScope) => void | Promise<void>;
}) {
  const { t } = useText();
  const [open, setOpen] = createSignal(false);
  const chosen = () => props.agents.filter((agent) => allows(props.scope, agent.id));
  const summary = () => {
    if (props.scope === null) return t("vault.agents.all");
    const agents = chosen();
    if (agents.length === 1 && agents[0]) return agents[0].name;
    return t("vault.agents.some", { chosen: agents.length, total: props.agents.length });
  };
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        class="marketplace-skill-agents-trigger"
        aria-label={t("vault.agents.choose", { name: props.name, agents: summary() })}
        disabled={props.disabled}
        onClick={() => setOpen(true)}
      >
        <AgentStack agents={chosen()} />
        {summary()}
      </Button>
      <Show when={open()}>
        <VaultAgentsDialog
          name={props.name}
          agents={props.agents}
          scope={props.scope}
          onSave={(scope) => void props.onChange(scope)}
          onClose={() => setOpen(false)}
        />
      </Show>
    </>
  );
}
