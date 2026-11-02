/**
 * What the pending list shows with no invitation: a faint copy of the list behind one invite action.
 * Sample invitations land in it one at a time, stay for a step, and leave together, then the cycle
 * starts again. Nothing behind the action can be focused or clicked. Under reduced motion the list
 * is still and full.
 */

import type { TeamInviteSummary } from "@openbot/contracts/ipc";
import { Button, Heading } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { prefersReducedMotion } from "@openbot/ui/utils";
import type { JSX } from "@solidjs/web";
import { createMemo, createSignal, For, onSettled } from "solid-js";

/** A new sample row lands on each step. */
const STEP_MS = 1600;
const WORD_MARKER = "\u0000";

export function ServerInvitesEmpty(props: {
  samples: readonly TeamInviteSummary[];
  /** The real pending row, so the samples look the same as the list they stand in for. */
  row: (invite: TeamInviteSummary) => JSX.Element;
  disabled: boolean;
  onInvite: () => void;
}) {
  const { t } = useText();
  const [step, setStep] = createSignal(0);
  // A cycle fills each slot on its own step, holds the full list for one step, and clears it on the last.
  const length = () => props.samples.length + 2;
  const phase = () => step() % length();
  const cycle = () => Math.floor(step() / length());
  const leaving = () => phase() === length() - 1;
  const shown = createMemo(() => props.samples.slice(0, phase() + 1));
  const title = createMemo(() => {
    const [before = "", after = ""] = t("server.invite.emptyTitle", { word: WORD_MARKER }).split(WORD_MARKER);
    return [before, after] as const;
  });

  onSettled(() => {
    if (prefersReducedMotion()) {
      setStep(props.samples.length - 1);
      return;
    }
    const timer = window.setInterval(() => setStep((value) => value + 1), STEP_MS);
    return () => window.clearInterval(timer);
  });

  return (
    <div class="server-invites-empty">
      <div class="server-invites-empty-board" aria-hidden="true" inert data-leaving={leaving() ? "" : undefined}>
        <For each={shown()} keyed={(invite) => `${cycle()}-${invite.id}`}>
          {(invite) => <div class="server-invites-empty-row">{props.row(invite())}</div>}
        </For>
      </div>
      <div class="server-invites-empty-pitch">
        <Heading
          as="h4"
          size="lg"
          class="server-invites-empty-title"
          // The handwritten word is an inline block, so the computed name would get a space before it.
          aria-label={`${t("server.invite.noPending")} ${t("server.invite.emptyTitle", { word: t("server.invite.emptyWord") })}`}
        >
          <span class="server-invites-empty-quiet">{t("server.invite.noPending")}</span>
          <span>
            {title()[0]}
            <span class="server-invites-empty-hand">{t("server.invite.emptyWord")}</span>
            {title()[1]}
          </span>
        </Heading>
        <Button class="server-invites-empty-action" disabled={props.disabled} onClick={() => props.onInvite()}>
          {t("server.invite.title")}
        </Button>
      </div>
    </div>
  );
}
