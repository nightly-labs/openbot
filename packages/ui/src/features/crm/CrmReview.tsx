import type { CrmProposal } from "@openbot/contracts/ipc";
import { Button, CircleCheck, IconButton, X } from "@openbot/ui";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import { useText } from "@openbot/ui/text";
import { createMemo, createSignal, createUniqueId, For, Show } from "solid-js";
import { AgentAccess, Owner, SideBody } from "./CrmParts";
import { matches, timeAgo } from "./crm-model";
import type { CrmViewModel } from "./crm-state";
import { PROPOSAL_ICON, useCrmText } from "./crm-text";

const AVATARS_SHOWN = 3;

function ChangeIcon(props: { proposal: CrmProposal }) {
  return (
    <Show when={PROPOSAL_ICON[props.proposal.change.kind]} keyed>
      {(Icon) => <Icon class="crm-suggestion-icon" aria-hidden="true" />}
    </Show>
  );
}

function useDecision(crm: CrmViewModel, proposal: () => CrmProposal) {
  const [busy, setBusy] = createSignal(false);
  const decide = async (approve: boolean) => {
    setBusy(true);
    try {
      await crm.decide(proposal(), approve);
    } finally {
      setBusy(false);
    }
  };
  return { busy, decide };
}

function ProposalCard(props: { crm: CrmViewModel; proposal: CrmProposal }) {
  const { t, locale } = useText();
  const crm = props.crm;
  const text = useCrmText(crm);
  const titleId = createUniqueId();
  const decision = useDecision(crm, () => props.proposal);
  return (
    <li class="crm-card crm-suggestion" aria-labelledby={titleId}>
      <div class="crm-card-head">
        <Show when={crm.customer(props.proposal.customerId)} keyed>
          {(customer) => (
            <Button variant="ghost" size="xs" class="crm-card-customer" onClick={() => crm.select(customer.id)}>
              {customer.name}
            </Button>
          )}
        </Show>
        <span class="crm-time">{timeAgo(locale(), props.proposal.createdAt)}</span>
      </div>
      <div class="crm-suggestion-title">
        <ChangeIcon proposal={props.proposal} />
        <h3 id={titleId} class="crm-card-title">
          {text.proposal(props.proposal)}
        </h3>
      </div>
      <Show when={props.proposal.reason}>
        <p class="crm-suggestion-reason">{props.proposal.reason}</p>
      </Show>
      <div class="crm-card-actions">
        <Owner crm={crm} id={props.proposal.agentId} label />
        <span class="crm-spacer" />
        <Button variant="ghost" size="sm" disabled={decision.busy()} onClick={() => void decision.decide(false)}>
          {t("crm.review.reject")}
        </Button>
        <Button size="sm" disabled={decision.busy()} onClick={() => void decision.decide(true)}>
          {t("crm.review.approve")}
        </Button>
      </div>
    </li>
  );
}

export function PendingProposal(props: { crm: CrmViewModel; proposal: CrmProposal }) {
  const { t } = useText();
  const text = useCrmText(props.crm);
  const decision = useDecision(props.crm, () => props.proposal);
  return (
    <div class="crm-side-pending">
      <ChangeIcon proposal={props.proposal} />
      <span>
        {t("crm.review.suggests", {
          agent: props.crm.agentName(props.proposal.agentId),
          change: text.proposal(props.proposal),
        })}
      </span>
      <Button variant="ghost" size="xs" disabled={decision.busy()} onClick={() => void decision.decide(false)}>
        {t("crm.review.reject")}
      </Button>
      <Button variant="outline" size="xs" disabled={decision.busy()} onClick={() => void decision.decide(true)}>
        {t("crm.review.approve")}
      </Button>
    </div>
  );
}

export function ReviewPanel(props: { crm: CrmViewModel }) {
  const { t } = useText();
  const crm = props.crm;
  const text = useCrmText(crm);
  const titleId = createUniqueId();
  const list = createMemo(() =>
    crm
      .proposals()
      .filter((proposal) =>
        matches(
          crm.view.query,
          text.proposal(proposal),
          crm.customer(proposal.customerId)?.name,
          proposal.reason,
          crm.agentName(proposal.agentId),
        ),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  );
  return (
    <aside class="crm-side crm-review" aria-labelledby={titleId}>
      <header class="crm-side-head">
        <h2 id={titleId} class="crm-review-title">
          {t("crm.review.title")}
        </h2>
        <span class="crm-spacer" />
        <AgentAccess crm={crm} />
        <IconButton label={t("crm.panel.close")} variant="ghost" size="icon-sm" onClick={() => crm.closePanel()}>
          <X aria-hidden="true" />
        </IconButton>
      </header>
      <SideBody>
        <Show
          when={list().length > 0}
          fallback={
            <div class="crm-empty">
              <CircleCheck aria-hidden="true" />
              <h3>{crm.view.query ? t("crm.review.noMatch") : t("crm.review.none")}</h3>
            </div>
          }
        >
          <ol class="crm-cards">
            <For each={list()}>{(proposal) => <ProposalCard crm={crm} proposal={proposal} />}</For>
          </ol>
        </Show>
      </SideBody>
    </aside>
  );
}

export function ReviewButton(props: { crm: CrmViewModel }) {
  const { t } = useText();
  const crm = props.crm;
  const count = () => crm.proposals().length;
  const avatars = createMemo(() =>
    crm
      .access()
      .flatMap((id) => crm.agent(id) ?? [])
      .slice(0, AVATARS_SHOWN),
  );
  return (
    <Button
      variant="ghost"
      size="sm"
      class="crm-review-button"
      aria-pressed={crm.view.agents ? "true" : "false"}
      onClick={() => crm.toggleAgents()}
    >
      <Show when={avatars().length > 0}>
        <span class="crm-review-avatars" aria-hidden="true">
          <For each={avatars()}>{(agent) => <AgentAvatar agent={agent} class="crm-avatar-sm" motion="hover" />}</For>
        </span>
      </Show>
      {t("crm.review.button")}
      <Show when={count() > 0}>
        <span class="crm-tab-count">{count()}</span>
      </Show>
    </Button>
  );
}
