import {
  type CreditServerWallet,
  type CreditsState,
  type CreditTransferDirection,
  creditsFromTenths,
  creditTenths,
} from "@openbot/contracts/credits";
import { ArrowLeftRight, Button, Dialog, IconButton, Input, ServerPlushLogo, X } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createSignal, Show, untrack } from "solid-js";
import { useText } from "../../text";
import { CreditIcon } from "./CreditIcon";
import { type CreditsCalls, type CreditsStore, createCreditsStore, creditsServer } from "./credits-store";

export interface MoveCreditsDialogProps {
  store: CreditsStore;
  server: CreditServerWallet;
  direction: CreditTransferDirection;
  onClose: () => void;
}

interface AmountText {
  whole: string;
  tenth: string | null;
}

function asciiDigits(value: string, localDigits: readonly string[]): string {
  return Array.from(value, (char) => {
    const digit = localDigits.indexOf(char);
    return digit < 0 ? char : String(digit);
  }).join("");
}

function parseAmountText(value: string, decimal: string, localDigits: readonly string[]): AmountText {
  const [whole = "", ...fraction] = asciiDigits(value, localDigits).split(decimal);
  const digits = whole.replace(/\D/g, "");
  if (fraction.length === 0) return { whole: digits, tenth: null };
  return { whole: digits, tenth: fraction.join("").replace(/\D/g, "").slice(0, 1) };
}

function amountTenths(text: AmountText): number {
  const tenths = Number(text.whole || "0") * 10 + Number(text.tenth || "0");
  return Math.min(tenths, Number.MAX_SAFE_INTEGER);
}

function WalletChip(props: { serverId: string | null; name: string }) {
  return (
    <span class="credit-move-chip">
      <Show when={props.serverId} fallback={<CreditIcon class="credit-move-chip-icon" tile />}>
        {(serverId) => <ServerPlushLogo class="credit-move-chip-logo" seed={serverId()} />}
      </Show>
      <span class="credit-move-chip-name">{props.name}</span>
    </span>
  );
}

export function MoveCreditsDialog(props: MoveCreditsDialogProps): JSX.Element {
  const { t, format } = useText();
  const [direction, setDirection] = createSignal(untrack(() => props.direction));
  const [value, setValue] = createSignal("");
  const [turns, setTurns] = createSignal(0);
  const toServer = () => direction() === "to_server";
  const personal = () => props.store.state.credits?.balance ?? 0;
  const source = () => (toServer() ? personal() : props.server.balance);
  const decimal = () => format.number(1.5).replace(/\p{Nd}/gu, "") || ".";
  const localDigits = () => Array.from({ length: 10 }, (_, digit) => format.number(digit));
  const text = () => parseAmountText(value(), decimal(), localDigits());
  const amount = () => creditsFromTenths(amountTenths(text()));
  const shown = () => {
    if (value() === "") return "";
    const whole = format.number(Number(text().whole || "0"), { maximumFractionDigits: 0 });
    const tenth = text().tenth;
    return tenth === null ? whole : `${whole}${decimal()}${tenth === "" ? "" : format.number(Number(tenth))}`;
  };
  const tooMuch = () => creditTenths(amount()) > creditTenths(source());
  const ready = () => amount() > 0 && !tooMuch();
  const pending = () => props.store.state.pending === "transfer";
  const submitLabel = () => {
    if (tooMuch()) return t("billing.credits.notEnough");
    if (!ready()) return t("billing.credits.move");
    return t("billing.credits.moveConfirm", { count: amount(), amount: format.number(amount()) });
  };
  const personalChip = () => <WalletChip serverId={null} name={t("billing.credits.yours")} />;
  const serverChip = () => <WalletChip serverId={props.server.serverId} name={props.server.name} />;
  const swap = () => {
    const nextSource = toServer() ? props.server.balance : personal();
    setDirection(toServer() ? "to_personal" : "to_server");
    setTurns((count) => count + 1);
    if (creditTenths(amount()) > creditTenths(nextSource)) setValue(format.number(nextSource));
  };
  const confirm = async () => {
    if (!ready()) return;
    const done = await props.store.transfer({
      serverId: props.server.serverId,
      direction: direction(),
      credits: amount(),
    });
    if (done) props.onClose();
  };

  return (
    <Dialog.Root open onOpenChange={(open) => !open && props.onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay>
          <Dialog.Content as="section" class="hosted-upsell-modal credit-move-modal">
            <header class="credit-move-header">
              <Dialog.Title as="h2" class="hosted-upsell-modal-title">
                {t("billing.credits.moveTitle")}
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
            <form
              class="credit-move-form"
              onSubmit={(event) => {
                event.preventDefault();
                void confirm();
              }}
            >
              <div class="credit-move-amount" data-invalid={tooMuch() ? "" : undefined}>
                <CreditIcon class="credit-move-amount-icon" />
                <Input
                  class="credit-move-input"
                  aria-label={t("billing.credits.amountLabel")}
                  invalid={tooMuch()}
                  inputmode="decimal"
                  autocomplete="off"
                  placeholder="0"
                  value={shown()}
                  disabled={pending()}
                  onValueChange={setValue}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                class="credit-move-max"
                disabled={pending() || source() <= 0}
                onClick={() => setValue(format.number(source()))}
              >
                {t("billing.credits.ofBalance", { amount: format.number(source()) })}
              </Button>
              <div
                class="credit-move-route"
                data-swapped={turns() > 0 ? "" : undefined}
                style={{ "--credit-swap-turns": turns() }}
              >
                <Show when={toServer()} fallback={serverChip()}>
                  {personalChip()}
                </Show>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  class="credit-move-swap"
                  aria-label={t("billing.credits.swap")}
                  disabled={pending()}
                  onClick={swap}
                >
                  <ArrowLeftRight aria-hidden="true" />
                </Button>
                <Show when={toServer()} fallback={personalChip()}>
                  {serverChip()}
                </Show>
              </div>
              <Button type="submit" class="credit-move-submit" disabled={!ready()} loading={pending()}>
                {submitLabel()}
              </Button>
            </form>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function RailMoveCreditsDialog(props: {
  calls: () => CreditsCalls | undefined;
  server: CreditServerWallet;
  onChange: (credits: CreditsState) => void;
  onClose: () => void;
}): JSX.Element {
  const store = createCreditsStore(props.calls, () => true, props.onChange);
  const server = () => creditsServer(store.state.credits, props.server.serverId) ?? props.server;
  return <MoveCreditsDialog store={store} server={server()} direction="to_server" onClose={props.onClose} />;
}
