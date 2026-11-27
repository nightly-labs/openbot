import type { AgentApproval, CreditsHold, CreditsHoldAction } from "@openbot/contracts/ipc";
import { classifyFailure } from "@openbot/telemetry";
import { Button, LabelTooltip, LabelTooltipTrigger, toast } from "@openbot/ui";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import { CreditAmount } from "@openbot/ui/features/credits/CreditIcon";
import { useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { createEffect, createSignal, For, onCleanup, Show, untrack } from "solid-js";
import type { AgentProfile } from "../../data";
import { CreditsBuyButton } from "../credits/CreditsRailChip";
import { UiBlockCard } from "./ui-blocks/UiBlockCard";

const THANKS_MS = 1_400;
const COST_MARK = "";
const BALANCE_MARK = "";

export type CreditsHoldAgent = Pick<AgentProfile, "avatarSeed" | "avatarHue" | "avatarColor" | "avatarUrl">;

export interface CreditsHoldControls {
  agent: (agentId: string) => CreditsHoldAgent | undefined;
  balance: () => number | null | undefined;
  buy: () => void;
  respond: (approval: AgentApproval, action: CreditsHoldAction) => Promise<CreditsHold | null>;
  unmute: () => Promise<void>;
}

type Phase = "held" | "thanks" | "answering";

function WithAmounts(props: { text: string; cost: number; balance: number }) {
  const parts = () => props.text.split(new RegExp(`(${COST_MARK}|${BALANCE_MARK})`));
  return (
    <For each={parts()}>
      {(part) =>
        part === COST_MARK ? (
          <CreditAmount credits={props.cost} class="credits-hold-amount" />
        ) : part === BALANCE_MARK ? (
          <CreditAmount credits={props.balance} class="credits-hold-amount" />
        ) : (
          part
        )
      }
    </For>
  );
}

function CostLine(props: { hold: CreditsHold }) {
  const { t } = useText();
  const marks = { cost: COST_MARK, balance: BALANCE_MARK };
  const text = () => {
    const { images, videos } = props.hold;
    if (images > 0 && videos > 0) return t("prompt.creditsHold.mixedCost", marks);
    if (videos > 0) return t("prompt.creditsHold.videosCost", { count: videos, ...marks });
    return t("prompt.creditsHold.imagesCost", { count: images, ...marks });
  };
  return <WithAmounts text={text()} cost={props.hold.cost} balance={props.hold.balance ?? 0} />;
}

export function CreditsHoldCard(props: { approval: AgentApproval; hold: CreditsHold; controls: CreditsHoldControls }) {
  const { t, errorMessage } = useText();
  const [hold, setHold] = createSignal(untrack(() => props.hold));
  const [phase, setPhase] = createSignal<Phase>("held");
  let thanksTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(thanksTimer));
  createEffect(
    () => props.hold,
    (next) => {
      if (untrack(phase) === "held") setHold(next);
    },
  );

  const failed = (error: unknown) => {
    toast.error(errorMessage(error, t("prompt.approval.answerFailed")), {
      report: { operation: "turn", source: "system", cause_code: classifyFailure(error) },
    });
  };

  const respond = async (action: CreditsHoldAction): Promise<CreditsHold | null | undefined> => {
    try {
      const approval = untrack(() => ({ ...props.approval }));
      return await props.controls.respond(approval, action);
    } catch (error) {
      failed(error);
      return undefined;
    }
  };

  const thankThen = (action: CreditsHoldAction) => {
    setPhase("thanks");
    clearTimeout(thanksTimer);
    thanksTimer = setTimeout(() => {
      void respond(action).then((still) => {
        if (still) setHold(still);
        if (still !== null) setPhase("held");
      });
    }, THANKS_MS);
  };

  createEffect(
    () => props.controls.balance(),
    (balance, previous) => {
      if (previous === undefined || balance === previous || untrack(phase) !== "held") return;
      const current = untrack(hold);
      if (current.reason !== "balance") return;
      if (typeof balance === "number" && balance >= current.cost) {
        thankThen("continue");
        return;
      }
      void respond("continue").then((still) => {
        if (still) setHold(still);
      });
    },
  );

  const serverWide = () => hold().canEnable;

  const answer = async (action: "skip" | "mute") => {
    if (phase() !== "held") return;
    setPhase("answering");
    const still = await respond(action);
    if (still !== null) {
      setPhase("held");
      return;
    }
    if (action === "mute")
      toast(serverWide() ? t("prompt.creditsHold.mutedServer") : t("prompt.creditsHold.mutedMember"), {
        description: serverWide()
          ? t("prompt.creditsHold.mutedServerUndo", { setting: t("server.settings.mediaApprovalAsk") })
          : undefined,
        action: {
          label: t("menu.undo"),
          onClick: () => {
            props.controls.unmute().catch(failed);
          },
        },
      });
  };

  const title = () => {
    if (phase() === "thanks") return t("prompt.creditsHold.thanks");
    return hold().reason === "balance" ? t("prompt.creditsHold.needMore") : t("prompt.creditsHold.cannotUse");
  };

  const subtitle = (): JSX.Element => {
    const current = hold();
    if (phase() === "thanks") return t("prompt.creditsHold.ready");
    if (current.reason === "balance") return <CostLine hold={current} />;
    return current.canEnable ? t("prompt.creditsHold.agentsOffAdmin") : t("prompt.creditsHold.agentsOffMember");
  };

  return (
    <UiBlockCard
      class="approval-card credits-hold-card"
      status="pending"
      icon={
        <AgentAvatar
          agent={props.controls.agent(props.approval.agentId)}
          mood={phase() === "thanks" ? "responded" : "working"}
          workingFaces
          transition="dissolve"
          motion="always"
          class="credits-hold-avatar"
        />
      }
      title={title()}
      subtitle={subtitle()}
      actions={
        <Show when={phase() !== "thanks"}>
          <LabelTooltip
            placement="bottom"
            content={serverWide() ? t("prompt.creditsHold.dontAskServer") : t("prompt.creditsHold.dontAskMember")}
          >
            <LabelTooltipTrigger
              as={Button}
              variant="ghost"
              size="sm"
              type="button"
              class="credits-hold-dont-ask"
              disabled={phase() !== "held"}
              onClick={() => void answer("mute")}
            >
              {t("prompt.creditsHold.dontAsk")}
            </LabelTooltipTrigger>
          </LabelTooltip>
          <Button
            variant="secondary"
            size="sm"
            type="button"
            disabled={phase() !== "held"}
            onClick={() => void answer("skip")}
          >
            {t("prompt.creditsHold.skip")}
          </Button>
          <Show when={hold().reason === "balance"}>
            <CreditsBuyButton size="sm" label={t("app.rail.creditsBuy")} onBuy={() => props.controls.buy()} />
          </Show>
          <Show when={hold().reason === "agentsOff" && hold().canEnable}>
            <Button size="sm" type="button" disabled={phase() !== "held"} onClick={() => thankThen("enable")}>
              {t("prompt.creditsHold.turnOn")}
            </Button>
          </Show>
        </Show>
      }
    />
  );
}
