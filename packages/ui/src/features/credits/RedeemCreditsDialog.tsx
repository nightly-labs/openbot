import {
  CREDIT_CODE_INPUT_LENGTH,
  CREDIT_CODE_LENGTH,
  type CreditRedeemRequest,
  formatCreditCode,
  isCreditCode,
  normalizeCreditCode,
} from "@openbot/contracts/credits";
import { Button, Confetti, Dialog, IconButton, Input, X } from "@openbot/ui";
import { type JSX, Portal } from "@solidjs/web";
import { createSignal, createStore, For, onSettled, Show, untrack } from "solid-js";
import { RollingPrice } from "../../rolling-price";
import { useText } from "../../text";
import { CreditIcon } from "./CreditIcon";
import { type CreditTarget, CreditTargetLogo } from "./CreditTargetSelect";
import type { CreditsStore } from "./credits-store";

export interface RedeemCreditsDialogProps {
  store: CreditsStore;
  target: CreditTarget;
  onClose: () => void;
}

interface Burst {
  id: number;
  origin: Element | undefined;
}

interface RedeemWin {
  credits: number;
  target: CreditTarget;
}

interface RedeemForm {
  code: string;
  error: string | null;
  won: RedeemWin | null;
}

const CODE_PLACEHOLDER = formatCreditCode("X".repeat(CREDIT_CODE_LENGTH));
const CONFETTI_WAVE_MS = 180;
const CONFETTI_LIFETIME_MS = 2_600;
const COUNT_START_MS = 120;
const ERROR_ID = "credit-redeem-error";

function createCelebration() {
  const [bursts, setBursts] = createSignal<readonly Burst[]>([]);
  const timers = new Set<number>();
  let nextId = 0;
  const later = (delay: number, run: () => void) => {
    const timer = window.setTimeout(() => {
      timers.delete(timer);
      run();
    }, delay);
    timers.add(timer);
  };
  onSettled(() => () => {
    for (const timer of timers) window.clearTimeout(timer);
  });
  const celebrate = (origins: readonly (Element | undefined)[]) => {
    origins.forEach((origin, wave) => {
      later(wave * CONFETTI_WAVE_MS, () => {
        nextId += 1;
        const id = nextId;
        setBursts((list) => [...list, { id, origin }]);
        later(CONFETTI_LIFETIME_MS, () => setBursts((list) => list.filter((burst) => burst.id !== id)));
      });
    });
  };
  return { bursts, celebrate };
}

function CountUp(props: { value: number }) {
  const { format } = useText();
  const [shown, setShown] = createSignal(0);
  onSettled(() => {
    const timer = window.setTimeout(() => setShown(untrack(() => props.value)), COUNT_START_MS);
    return () => window.clearTimeout(timer);
  });
  return (
    <RollingPrice
      class="credit-redeem-count"
      value={shown()}
      format={(value) => format.number(value, { signDisplay: "always" })}
    />
  );
}

function StarBurst(props: { size: "md" | "lg"; ref?: (element: HTMLElement) => void }) {
  return (
    <span class="credit-redeem-star" data-size={props.size} ref={props.ref} aria-hidden="true">
      <span class="credit-redeem-rays" />
      <CreditIcon class="credit-redeem-star-icon" tile />
    </span>
  );
}

function BalanceChange(props: { win: RedeemWin }) {
  const { t, format } = useText();
  return (
    <p class="credit-after credit-redeem-after">
      <CreditTargetLogo target={props.win.target} class="credit-redeem-after-logo" />
      <span class="credit-after-name">{props.win.target.name}</span>
      <span class="credit-after-numbers">
        <CreditIcon />
        {t("billing.credits.balanceChange", {
          from: format.number(props.win.target.balance),
          to: format.number(props.win.target.balance + props.win.credits),
        })}
      </span>
    </p>
  );
}

function redeemRequest(code: string, target: CreditTarget): CreditRedeemRequest {
  return target.serverId === null ? { code } : { code, serverId: target.serverId };
}

export function RedeemCreditsDialog(props: RedeemCreditsDialogProps): JSX.Element {
  const { t, errorMessage } = useText();
  const [form, setForm] = createStore<RedeemForm>({ code: "", error: null, won: null });
  const celebration = createCelebration();
  let input: HTMLInputElement | undefined;
  let star: HTMLElement | undefined;
  let left: HTMLElement | undefined;
  let right: HTMLElement | undefined;
  const pending = () => props.store.state.pending === "redeem";
  const ready = () => isCreditCode(form.code);
  const status = () => {
    if (form.won) return "success";
    if (pending()) return "verifying";
    return form.error ? "error" : "idle";
  };

  const submit = async () => {
    if (!ready() || pending() || form.won) return;
    const target = props.target;
    setForm((draft) => {
      draft.error = null;
    });
    try {
      const result = await props.store.redeem(redeemRequest(form.code, target));
      if (!result) return;
      setForm((draft) => {
        draft.won = { credits: result.credits, target };
      });
      window.requestAnimationFrame(() => celebration.celebrate([star, left, right, star]));
    } catch (error) {
      setForm((draft) => {
        draft.error = errorMessage(error, t("billing.credits.redeemFailed"));
      });
    }
  };

  return (
    <>
      <Dialog.Root open onOpenChange={(open) => !open && !pending() && props.onClose()}>
        <Dialog.Portal>
          <Dialog.Overlay>
            <Dialog.Content
              as="section"
              class="hosted-upsell-modal credit-redeem-modal"
              data-tier="plus"
              data-status={status()}
              onOpenAutoFocus={(event) => {
                if (!input) return;
                event.preventDefault();
                input.focus({ preventScroll: true });
              }}
            >
              <span
                class="credit-redeem-anchor"
                data-side="start"
                ref={(element: HTMLSpanElement) => {
                  left = element;
                }}
                aria-hidden="true"
              />
              <span
                class="credit-redeem-anchor"
                data-side="end"
                ref={(element: HTMLSpanElement) => {
                  right = element;
                }}
                aria-hidden="true"
              />
              <header class="credit-move-header">
                <Dialog.Title as="h2" class="hosted-upsell-modal-title">
                  {t("billing.credits.redeemTitle")}
                </Dialog.Title>
                <IconButton
                  label={t("common.close")}
                  variant="ghost"
                  disabled={pending()}
                  onClick={() => props.onClose()}
                >
                  <X />
                </IconButton>
              </header>
              <Show
                when={form.won}
                fallback={
                  <form
                    class="credit-redeem-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void submit();
                    }}
                  >
                    <StarBurst size="md" />
                    <div class="credit-redeem-field">
                      <Input
                        ref={(element: HTMLInputElement) => {
                          input = element;
                        }}
                        class="credit-redeem-input"
                        aria-label={t("billing.credits.redeemLabel")}
                        aria-describedby={form.error ? ERROR_ID : undefined}
                        invalid={form.error !== null}
                        autocomplete="off"
                        autocapitalize="characters"
                        spellcheck={false}
                        maxlength={CREDIT_CODE_INPUT_LENGTH}
                        placeholder={CODE_PLACEHOLDER}
                        value={formatCreditCode(form.code)}
                        disabled={pending()}
                        onValueChange={(value) =>
                          setForm((draft) => {
                            draft.code = normalizeCreditCode(value).slice(0, CREDIT_CODE_LENGTH);
                            draft.error = null;
                          })
                        }
                      />
                      <Show when={form.error}>
                        {(message) => (
                          <p id={ERROR_ID} class="credit-redeem-error" role="alert">
                            {message()}
                          </p>
                        )}
                      </Show>
                    </div>
                    <Button type="submit" class="credit-move-submit" disabled={!ready()} loading={pending()}>
                      {t("billing.credits.redeemSubmit")}
                    </Button>
                  </form>
                }
              >
                {(won) => (
                  <div class="credit-redeem-won">
                    <StarBurst
                      size="lg"
                      ref={(element) => {
                        star = element;
                      }}
                    />
                    <p class="credit-redeem-amount">
                      <CountUp value={won().credits} />
                      <span class="credit-split-unit">{t("billing.credits.unit")}</span>
                    </p>
                    <BalanceChange win={won()} />
                    <Button class="credit-move-submit" onClick={() => props.onClose()}>
                      {t("common.done")}
                    </Button>
                  </div>
                )}
              </Show>
            </Dialog.Content>
          </Dialog.Overlay>
        </Dialog.Portal>
      </Dialog.Root>
      <Portal>
        <div class="credit-redeem-confetti">
          <For each={celebration.bursts()} keyed={(burst) => burst.id}>
            {(burst) => <Confetti origin={burst().origin} />}
          </For>
        </div>
      </Portal>
    </>
  );
}
