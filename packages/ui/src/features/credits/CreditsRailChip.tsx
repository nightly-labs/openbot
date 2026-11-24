import { ArrowLeftRight, Button, Popover, Switch } from "@openbot/ui";
import { type MotionPlace, useMenuMotion } from "@openbot/ui/menu-motion";
import { useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { createSignal, createUniqueId, onCleanup, Show } from "solid-js";
import { CreditIcon } from "./CreditIcon";
import "./credits-rail.css";

const OPEN_DELAY = 120;
const CLOSE_DELAY = 180;
const EXACT_CREDITS_LIMIT = 10_000;
const RAIL_GROUP = ".window-rail-group";
const RAIL_PANEL_SHOWN = ".ui-motion-tooltip:is([data-expanded], [data-menu-hold])";

export interface CreditsRailChipProps {
  balance: number;
  current: boolean;
  agents?: boolean | undefined;
  onAgentsChange?: ((agents: boolean) => void) | undefined;
  ask?: boolean | undefined;
  onAskChange?: ((ask: boolean) => void) | undefined;
  walletName?: string | null | undefined;
  onMove?: (() => void) | undefined;
  onBuy: () => void;
}

function railPanelShown(): boolean {
  return document.querySelector(RAIL_PANEL_SHOWN) !== null;
}

function movesToRail(event: PointerEvent): boolean {
  return event.relatedTarget instanceof Element && event.relatedTarget.closest(RAIL_GROUP) !== null;
}

function createHoverCard() {
  const [open, setOpen] = createSignal(false);
  const [pressed, setPressed] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const settle = (value: boolean, delay: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => setOpen(value), delay);
  };
  onCleanup(() => clearTimeout(timer));
  return {
    open,
    enter: () => settle(true, railPanelShown() ? 0 : OPEN_DELAY),
    keep: () => clearTimeout(timer),
    leave: (event: PointerEvent) => {
      if (!pressed()) settle(false, movesToRail(event) ? 0 : CLOSE_DELAY);
    },
    press: () => {
      clearTimeout(timer);
      const next = !(open() && pressed());
      setPressed(next);
      setOpen(next);
    },
    close: () => {
      clearTimeout(timer);
      setPressed(false);
      setOpen(false);
    },
  };
}

function GlowSpin() {
  return (
    <>
      <span class="credits-rail-spin credits-rail-spin-a" />
      <span class="credits-rail-spin credits-rail-spin-b" />
      <span class="credits-rail-spin credits-rail-spin-c" />
      <span class="credits-rail-spin credits-rail-spin-d" />
    </>
  );
}

export function CreditsBuyButton(props: { label: string; size?: "xs" | "sm" | undefined; onBuy: () => void }) {
  return (
    <Button type="button" size={props.size ?? "xs"} class="credits-rail-buy" onClick={props.onBuy}>
      <span class="credits-rail-buy-star" aria-hidden="true">
        <span class="credits-rail-star-haze">
          <span class="credits-rail-star-light">
            <GlowSpin />
          </span>
        </span>
        <span class="credits-rail-star-light" />
      </span>
      {props.label}
      <span class="credits-rail-glow" aria-hidden="true">
        <span class="credits-rail-glow-haze">
          <GlowSpin />
        </span>
        <span class="credits-rail-glow-ring">
          <GlowSpin />
        </span>
        <span class="credits-rail-glow-fill" />
      </span>
    </Button>
  );
}

function RailSwitch(props: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  const id = `credits-rail-switch-${createUniqueId()}`;
  return (
    <label for={id} class="credits-rail-row">
      <span class="credits-rail-row-label">{props.label}</span>
      <Switch id={id} class="credits-rail-switch" checked={props.checked} onChange={props.onChange} />
    </label>
  );
}

function CreditsCardContent(props: {
  place: () => MotionPlace | undefined;
  anchor: () => HTMLElement | undefined;
  content: (element: HTMLElement) => void;
  keep: () => void;
  leave: (event: PointerEvent) => void;
  title: string;
  children: JSX.Element;
}) {
  const titleId = `credits-rail-title-${createUniqueId()}`;
  const motion = useMenuMotion(props.place);
  return (
    <Popover.Content
      ref={(element: HTMLElement) => {
        props.content(element);
        motion(element);
      }}
      class="ui-popover-menu-surface credits-rail-card"
      aria-labelledby={titleId}
      onOpenAutoFocus={(event: Event) => event.preventDefault()}
      onCloseAutoFocus={(event: Event) => event.preventDefault()}
      onFocusOutside={(event: Event) => event.preventDefault()}
      onPointerDownOutside={(event: CustomEvent<{ originalEvent: PointerEvent }>) => {
        const target = event.detail.originalEvent.target;
        if (target instanceof Node && props.anchor()?.contains(target)) event.preventDefault();
      }}
      onPointerEnter={props.keep}
      onPointerLeave={props.leave}
    >
      <Popover.Title id={titleId} class="sr-only">
        {props.title}
      </Popover.Title>
      {props.children}
    </Popover.Content>
  );
}

export function CreditsRailChip(props: CreditsRailChipProps) {
  const { t, format } = useText();
  const card = createHoverCard();
  let anchor: HTMLButtonElement | undefined;
  let content: HTMLElement | undefined;
  const place = (): MotionPlace | undefined => {
    const group = anchor?.closest(RAIL_GROUP);
    return anchor && group ? { trigger: anchor, group } : undefined;
  };
  const exact = (credits: number) => format.number(credits, { maximumFractionDigits: 2 });
  const short = (credits: number) =>
    credits < EXACT_CREDITS_LIMIT
      ? format.number(credits, { maximumFractionDigits: 0, roundingMode: "trunc" })
      : format.number(credits, { notation: "compact", maximumFractionDigits: 1, roundingMode: "trunc" });
  const agentsOff = () => props.agents === false;
  const label = () => {
    const values = { count: props.balance, amount: exact(props.balance) };
    return agentsOff() ? t("app.rail.creditsBalanceAgentsOff", values) : t("app.rail.creditsBalance", values);
  };
  const focusCard = () => {
    queueMicrotask(() => content?.querySelector<HTMLElement>("button, input")?.focus());
  };
  const buy = () => {
    card.close();
    props.onBuy();
  };
  const move = (onMove: () => void) => {
    card.close();
    onMove();
  };
  const rowsShown = () =>
    (props.agents !== undefined && props.onAgentsChange) ||
    (props.ask !== undefined && props.onAskChange) ||
    props.onMove;
  return (
    <>
      <Button
        ref={(element: HTMLButtonElement) => {
          anchor = element;
        }}
        variant="ghost"
        type="button"
        class="window-rail-button credits-rail-chip"
        aria-label={label()}
        aria-haspopup="dialog"
        aria-expanded={card.open() ? "true" : "false"}
        aria-current={props.current ? "page" : undefined}
        data-agents={agentsOff() ? "off" : "on"}
        data-empty={props.balance <= 0 ? "" : undefined}
        data-open={card.open() ? "" : undefined}
        onPointerEnter={card.enter}
        onPointerLeave={card.leave}
        onClick={() => {
          card.press();
          if (card.open()) focusCard();
        }}
      >
        <span class="credits-rail-tile">
          <CreditIcon class="credits-rail-star" />
        </span>
        <span class="credits-rail-count" aria-hidden="true">
          {short(props.balance)}
        </span>
      </Button>
      <Popover.Root
        open={card.open()}
        onOpenChange={(open) => {
          if (!open) card.close();
        }}
        anchorRef={() => anchor}
        placement="right-end"
        gutter={10}
        modal={false}
      >
        <Popover.Portal>
          <CreditsCardContent
            place={place}
            anchor={() => anchor}
            content={(element) => {
              content = element;
            }}
            keep={card.keep}
            leave={card.leave}
            title={props.walletName ?? t("billing.credits.yours")}
          >
            <div class="credits-rail-body" data-agents={agentsOff() ? "off" : "on"}>
              <div class="credits-rail-head">
                <span class="credits-rail-head-icon" aria-hidden="true">
                  <CreditIcon class="credits-rail-head-star" />
                </span>
                <span class="credits-rail-amount">
                  <span class="credits-rail-number">{exact(props.balance)}</span>
                  <span class="credits-rail-unit">{t("billing.credits.unit")}</span>
                </span>
                <CreditsBuyButton label={t("app.rail.creditsBuy")} onBuy={buy} />
              </div>
              <Show when={rowsShown()}>
                <div class="credits-rail-rows">
                  <Show when={props.agents !== undefined && props.onAgentsChange}>
                    {(onAgentsChange) => (
                      <RailSwitch
                        label={t("app.rail.creditsAgents")}
                        checked={!agentsOff()}
                        onChange={(agents) => onAgentsChange()(agents)}
                      />
                    )}
                  </Show>
                  <Show when={props.ask !== undefined && props.onAskChange}>
                    {(onAskChange) => (
                      <RailSwitch
                        label={t("app.rail.creditsAsk")}
                        checked={props.ask === true}
                        onChange={(ask) => onAskChange()(ask)}
                      />
                    )}
                  </Show>
                  <Show when={props.onMove}>
                    {(onMove) => (
                      <Button
                        type="button"
                        variant="ghost"
                        class="credits-rail-row credits-rail-move"
                        onClick={() => move(onMove())}
                      >
                        <span class="credits-rail-row-label">{t("billing.credits.moveTitle")}</span>
                        <ArrowLeftRight class="credits-rail-move-icon" aria-hidden="true" />
                      </Button>
                    )}
                  </Show>
                </div>
              </Show>
            </div>
          </CreditsCardContent>
        </Popover.Portal>
      </Popover.Root>
    </>
  );
}
