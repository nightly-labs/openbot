import { AppLogo, ProviderLogo } from "@openbot/brand";
import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import type { ComparePage, OpenBotPlan, RoundupApp } from "../../content/compare/comparison";
import { formatArticleDate } from "../../lib/content-collection";
import { EXTERNAL_LINK_REL } from "../../lib/landing-links";
import { createLandingReveal } from "../landing/createLandingReveal";
import { LandingIcon } from "../landing/LandingIcon";
import { RivalMark, type RivalMarkName } from "./RivalMark";

// The parts that every kind of comparison page draws: OpenBot against a rival, two
// other products against each other, and a roundup of many apps.

/** A section with a heading that comes in as it scrolls into view. */
export function RevealSection(props: {
  class: string;
  titleId: string;
  title: string;
  id?: string;
  children: JSX.Element;
}) {
  let section: HTMLElement | undefined;
  const revealed = createLandingReveal(() => section, { rootMargin: "0px 0px -15% 0px" });

  return (
    <section
      ref={section}
      id={props.id}
      class={`compare-section ${props.class}`}
      aria-labelledby={props.titleId}
      data-revealed={revealed() ? "true" : "false"}
    >
      <h2 class="compare-heading" id={props.titleId}>
        {props.title}
      </h2>
      {props.children}
    </section>
  );
}

/** One side of a comparison. A side with no `mark` is OpenBot, drawn with its own logo. */
export interface SideProps {
  side: string;
  name: string;
  mark?: RivalMarkName | undefined;
}

/** The mark of one side: OpenBot's logo, or the compared product's mark. */
export function SideMark(props: { mark?: RivalMarkName | undefined; class: string; blink?: boolean }) {
  return (
    <Show
      when={props.mark}
      fallback={<AppLogo variant="production" animation={props.blink ? "blink" : "none"} class={props.class} />}
    >
      {(mark) => <RivalMark name={mark()} class={`${props.class} compare-mark-rival`} />}
    </Show>
  );
}

/**
 * The frosted plate with both marks and "vs" between them. The hero shows the
 * names under the marks; an index card shows the marks only.
 */
export function CompareMarks(props: { sides: readonly [SideProps, SideProps]; small?: boolean }) {
  return (
    <span class={props.small ? "compare-marks compare-marks-small" : "compare-marks"}>
      <CompareMarkSide {...props.sides[0]} small={props.small} />
      <span class="compare-vs">vs</span>
      <CompareMarkSide {...props.sides[1]} small={props.small} />
    </span>
  );
}

/** The frosted plate with the mark of every app in a roundup, in the order of the list. */
export function CompareMarkRow(props: { apps: readonly Pick<RoundupApp, "mark">[]; small?: boolean }) {
  return (
    <span class={props.small ? "compare-marks compare-marks-small compare-mark-row" : "compare-marks compare-mark-row"}>
      <For each={props.apps}>
        {(app) => (
          <span class="compare-mark">
            <SideMark mark={app.mark === "openbot" ? undefined : app.mark} class="compare-mark-logo" />
          </span>
        )}
      </For>
    </span>
  );
}

function CompareMarkSide(props: SideProps & { small?: boolean | undefined }) {
  return (
    <span class="compare-mark" data-side={props.side}>
      <SideMark mark={props.mark} class="compare-mark-logo" blink={!props.small} />
      <Show when={!props.small}>
        <span class="compare-mark-name">{props.name}</span>
      </Show>
    </span>
  );
}

export function PlanCard(props: { plan: OpenBotPlan; index: number; highlighted?: boolean }) {
  return (
    <li
      class="compare-plan"
      data-highlighted={props.highlighted ? "true" : undefined}
      style={{ "--compare-index": props.index }}
    >
      <span class="compare-plan-logo-frame" aria-hidden="true">
        {props.plan.provider === "custom" ? (
          <LandingIcon name="cpu" class="compare-plan-logo compare-plan-logo-custom" />
        ) : (
          <ProviderLogo provider={props.plan.provider} class="compare-plan-logo" />
        )}
      </span>
      <span class="compare-plan-name">{props.plan.name}</span>
      <span class="compare-plan-text">{props.plan.plan}</span>
    </li>
  );
}

/** A value in the table. The better one says so in words, for a reader who does not see the mark. */
export function ValueCell(props: { side: string; better: string | undefined; text: string }) {
  const isBetter = () => props.better === props.side;
  return (
    <td data-side={props.side} data-better={isBetter() ? "true" : undefined}>
      <Show when={isBetter()}>
        <span class="compare-better-mark">
          <LandingIcon name="check" class="compare-better-icon" />
          <span class="landing-visually-hidden">Better: </span>
        </span>
      </Show>
      {props.text}
    </td>
  );
}

/** The pill on a card whose side is better on its topic. */
function BetterBadge(props: { label: string }) {
  return (
    <span class="compare-better-badge">
      <LandingIcon name="check" class="compare-better-badge-icon" />
      {props.label}
    </span>
  );
}

export function SideLabel(props: SideProps & { class?: string }) {
  return (
    <span class="compare-side-label">
      <SideMark mark={props.mark} class={props.class ?? "compare-side-logo"} />
      {props.name}
    </span>
  );
}

export function ChoiceCard(props: SideProps & { points: readonly string[]; recommended?: boolean }) {
  return (
    <div
      class="compare-card compare-choice"
      data-side={props.side}
      data-better={props.recommended ? "true" : undefined}
    >
      <div class="compare-card-head">
        <h3 class="compare-card-title">
          Choose <SideLabel {...props} /> if
        </h3>
        <Show when={props.recommended}>
          <BetterBadge label="Recommended" />
        </Show>
      </div>
      <ul class="compare-choice-list">
        <For each={props.points}>
          {(point) => (
            <li>
              <Show when={props.recommended} fallback={<span class="compare-choice-dot" aria-hidden="true" />}>
                <LandingIcon name="check" class="compare-choice-check" />
              </Show>
              {point}
            </li>
          )}
        </For>
      </ul>
    </div>
  );
}

export function SideCard(props: SideProps & { text: string; better: string | undefined }) {
  const isBetter = () => props.better === props.side;
  return (
    <div class="compare-card" data-side={props.side} data-better={isBetter() ? "true" : undefined}>
      <div class="compare-card-head">
        <h3 class="compare-card-title">
          <SideLabel {...props} />
        </h3>
        <Show when={isBetter()}>
          <BetterBadge label="Better" />
        </Show>
      </div>
      <p class="compare-card-text">{props.text}</p>
    </div>
  );
}

/** The text with each use of a name held on one line: "Grok" at a line end and "Bot" under it reads as two words. */
export function UnbrokenName(props: { text: string; names: readonly string[] }) {
  const parts = () => {
    const pattern = props.names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")).join("|");
    // The capturing group keeps each name in the result, at the odd indexes.
    return props.text.split(new RegExp(`(${pattern})`, "u"));
  };
  return (
    <For each={parts()}>{(part, index) => (index() % 2 === 1 ? <span class="compare-nowrap">{part}</span> : part)}</For>
  );
}

/** The date under the title, and a link to the sources. */
export function CheckedMeta(props: { checkedAt: string }) {
  return (
    <p class="post-meta compare-meta">
      <span>
        Checked <time datetime={props.checkedAt}>{formatArticleDate(props.checkedAt)}</time>
      </span>
      <span aria-hidden="true">·</span>
      <a href="#compare-sources">Sources</a>
    </p>
  );
}

export function CompareFaq(props: { faq: ComparePage["faq"] }) {
  return (
    <RevealSection class="compare-faq" titleId="compare-faq-title" title="Questions">
      <div class="compare-faq-list">
        <For each={props.faq}>
          {(entry, index) => (
            <details class="compare-faq-item" style={{ "--compare-index": index() }}>
              <summary class="compare-faq-question">
                {entry.question}
                <LandingIcon name="chevron-down" class="compare-faq-chevron" />
              </summary>
              <p class="compare-faq-answer">{entry.answer}</p>
            </details>
          )}
        </For>
      </div>
    </RevealSection>
  );
}

/** `subject` names what the sources are about, as in "Every statement about {subject}". */
export function CompareSources(props: { subject: string; page: Pick<ComparePage, "sources" | "checkedAt"> }) {
  return (
    <RevealSection class="compare-sources" titleId="compare-sources-title" title="Sources" id="compare-sources">
      <p class="compare-sources-note">
        Every statement about {props.subject} comes from the pages below, checked on{" "}
        <time datetime={props.page.checkedAt}>{formatArticleDate(props.page.checkedAt)}</time>. They can change after
        that date.
      </p>
      <ul class="compare-sources-list">
        <For each={props.page.sources}>
          {(source) => (
            <li>
              <a href={source.url} target="_blank" rel={EXTERNAL_LINK_REL}>
                {source.label}
                <LandingIcon name="arrow-up-right" class="compare-sources-icon" />
              </a>
            </li>
          )}
        </For>
      </ul>
    </RevealSection>
  );
}
