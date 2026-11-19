import type { TeamInviteSummary } from "@openbot/contracts/ipc";
import { Button, Heading } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { prefersReducedMotion } from "@openbot/ui/utils";
import type { JSX } from "@solidjs/web";
import { createMemo, createSignal, For, onSettled } from "solid-js";

const STEP_MS = 1600;
const WORD_MARKER = "\u0000";

export function ServerInvitesEmpty(props: {
  samples: readonly TeamInviteSummary[];
  row: (invite: TeamInviteSummary) => JSX.Element;
  disabled: boolean;
  onInvite: () => void;
}) {
  const { t } = useText();
  const [step, setStep] = createSignal(0);
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
