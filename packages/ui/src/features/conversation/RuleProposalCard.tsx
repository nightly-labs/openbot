/**
 * A rule that the memory review learned from the chat. Accept adds it to the agent's instruction
 * file, under "Learned rules", and Dismiss keeps it out; the line keeps the answer, and Undo opens it
 * again. The instruction file is per agent, so the rule changes only this agent.
 */

import type { AgentRuleProposal } from "@openbot/contracts/ipc";
import { Button, Check, FileText, Sparkles, Undo2 } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createSignal, Match, Show, Switch } from "solid-js";
import { useText } from "../../text";

export function RuleProposalCard(props: {
  proposal: AgentRuleProposal;
  /** Absent where the agent is not on this computer: the card then only shows the rule. */
  onAccept?: (() => Promise<void>) | undefined;
  onDismiss?: (() => Promise<void>) | undefined;
  /** Opens an answered line again. An accepted rule leaves the instruction file first. */
  onUndo?: (() => Promise<void>) | undefined;
  /** Opens the Instructions page of the agent settings. */
  onView?: (() => void) | undefined;
}): JSX.Element {
  const { t, errorMessage } = useText();
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const undo = () => (
    <Show when={props.onUndo}>
      <Button size="sm" variant="ghost" disabled={busy()} onClick={() => void answer(props.onUndo)}>
        <Undo2 aria-hidden="true" />
        {t("chat.ruleProposal.undo")}
      </Button>
    </Show>
  );

  async function answer(action: (() => Promise<void>) | undefined): Promise<void> {
    if (!action || busy()) return;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (failure) {
      setError(errorMessage(failure, t("error.agent.ruleProposalFailed")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section class="rule-proposal" data-status={props.proposal.status} aria-label={t("chat.ruleProposal.label")}>
      <header class="rule-proposal-head">
        <Sparkles aria-hidden="true" />
        {t("chat.ruleProposal.label")}
      </header>
      <p class="rule-proposal-rule">{props.proposal.rule}</p>
      <Show when={props.proposal.reason}>
        <p class="rule-proposal-reason">{t("chat.ruleProposal.reason", { reason: props.proposal.reason })}</p>
      </Show>
      <Switch>
        <Match when={props.proposal.status === "proposed" && props.onAccept}>
          <div class="rule-proposal-actions">
            <Button size="sm" disabled={busy()} onClick={() => void answer(props.onAccept)}>
              {t("chat.ruleProposal.accept")}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy()} onClick={() => void answer(props.onDismiss)}>
              {t("chat.ruleProposal.dismiss")}
            </Button>
          </div>
        </Match>
        <Match when={props.proposal.status === "accepted"}>
          <div class="rule-proposal-actions">
            <span class="rule-proposal-status">
              <Check aria-hidden="true" />
              {t("chat.ruleProposal.accepted")}
            </span>
            <Show when={props.onView}>
              {(view) => (
                <Button size="sm" variant="ghost" onClick={() => view()()}>
                  <FileText aria-hidden="true" />
                  {t("chat.ruleProposal.view")}
                </Button>
              )}
            </Show>
            {undo()}
          </div>
        </Match>
        <Match when={props.proposal.status === "dismissed"}>
          <div class="rule-proposal-actions">
            <span class="rule-proposal-status">{t("chat.ruleProposal.dismissed")}</span>
            {undo()}
          </div>
        </Match>
      </Switch>
      <Show when={error()}>
        <p class="rule-proposal-error" role="alert">
          {error()}
        </p>
      </Show>
    </section>
  );
}
