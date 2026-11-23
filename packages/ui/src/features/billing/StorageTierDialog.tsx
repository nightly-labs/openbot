import type {
  BillingCurrency,
  BillingInterval,
  BillingStorageUpgrade,
  BillingStorageUpgradeTier,
} from "@openbot/contracts/billing";
import { Badge, Button, Dialog, Progress, RadioGroup } from "@openbot/ui";
import { createSignal, For, Show } from "solid-js";
import { useText } from "../../text";
import { formatMinorMoney } from "./money";
import "./billing-server-lifecycle-preview.css";

export interface StorageTierDisk {
  level: "low" | "full";
  freeBytes: number;
  totalBytes: number;
}

export interface StorageTierDialogProps {
  mode: "offer" | "billing";
  serverName: string;
  disk?: StorageTierDisk | undefined;
  storageGb: number;
  interval: BillingInterval;
  currency: BillingCurrency;
  amount: number | null;
  upgrades: readonly BillingStorageUpgrade[];
  pending: boolean;
  error: string | null;
  onBuy: (tier: BillingStorageUpgradeTier) => void;
  onFreeUpSpace?: (() => void) | undefined;
  onClose: () => void;
}

const CURRENT = "current";

function bestValueTier(upgrades: readonly BillingStorageUpgrade[]): BillingStorageUpgradeTier | undefined {
  if (upgrades.length < 2) return undefined;
  let best: { tier: BillingStorageUpgradeTier; perGb: number } | undefined;
  for (const upgrade of upgrades) {
    if (upgrade.amount === null) return undefined;
    const perGb = upgrade.amount / upgrade.storageGb;
    if (!best || perGb < best.perGb) best = { tier: upgrade.tier, perGb };
  }
  return best?.tier;
}

export function StorageTierDialog(props: StorageTierDialogProps) {
  const { t, format } = useText();
  let primary: HTMLButtonElement | undefined;
  const best = () => bestValueTier(props.upgrades);
  const [picked, setSelected] = createSignal<string | null>(null);
  const selected = () => {
    const value = picked();
    return value !== null && props.upgrades.some((upgrade) => String(upgrade.tier) === value)
      ? value
      : String(best() ?? props.upgrades.at(-1)?.tier ?? "");
  };
  const chosen = () => props.upgrades.find((upgrade) => String(upgrade.tier) === selected());
  const gigabytes = (size: number) => t("format.fileSize.gigabytes", { size: format.number(size) });
  const price = (amount: number | null) =>
    amount === null
      ? ""
      : t(props.interval === "month" ? "billing.server.price.month" : "billing.server.price.year", {
          amount: formatMinorMoney(format, amount, props.currency),
        });
  const rows = () => [
    { value: CURRENT, storageGb: props.storageGb, amount: props.amount },
    ...props.upgrades.map((upgrade) => ({ value: String(upgrade.tier), ...upgrade })),
  ];
  const usedBytes = (disk: StorageTierDisk) => Math.max(0, disk.totalBytes - disk.freeBytes);
  const percent = (disk: StorageTierDisk) =>
    disk.totalBytes > 0 ? Math.floor((usedBytes(disk) / disk.totalBytes) * 100) : 0;
  return (
    <Dialog.Root open onOpenChange={(open) => !open && props.onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay>
          <Dialog.Content
            as="section"
            class="hosted-upsell-modal storage-tier-modal"
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              primary?.focus({ preventScroll: true });
            }}
          >
            <Dialog.Title as="h2" class="hosted-upsell-modal-title">
              {props.mode === "offer"
                ? t("server.upgrade.title")
                : t("billing.storage.title", { server: props.serverName })}
            </Dialog.Title>
            <Show when={props.disk}>
              {(disk) => (
                <div class="storage-tier-meter" data-level={disk().level}>
                  <Progress
                    value={percent(disk())}
                    aria-label={t("sidebar.storage.meterLabel", { server: props.serverName })}
                    getValueLabel={() => t("sidebar.storage.used", { percent: format.percent(percent(disk()) / 100) })}
                  />
                  <span>
                    {t("server.upgrade.used", {
                      used: format.fileSize(usedBytes(disk())),
                      total: format.fileSize(disk().totalBytes),
                    })}
                  </span>
                </div>
              )}
            </Show>
            <Show when={props.mode === "offer"}>
              <Dialog.Description as="p" class="hosted-upsell-modal-description">
                {t("server.upgrade.description", { server: props.serverName })}
              </Dialog.Description>
            </Show>
            <RadioGroup.Root
              class="billing-lifecycle-timing storage-tier-options"
              value={selected()}
              disabled={props.pending}
              onChange={(value) => value && setSelected(value)}
            >
              <RadioGroup.Label class="sr-only">{t("billing.action.addStorage")}</RadioGroup.Label>
              <For each={rows()} keyed={(row) => row.value}>
                {(row) => (
                  <RadioGroup.Item
                    value={row().value}
                    disabled={row().value === CURRENT}
                    class="billing-lifecycle-timing-option"
                  >
                    <RadioGroup.ItemInput />
                    <RadioGroup.ItemControl class="billing-lifecycle-radio" />
                    <RadioGroup.ItemLabel class="storage-tier-option">
                      <span class="storage-tier-option-size">
                        {gigabytes(row().storageGb)}
                        <Show when={row().value === CURRENT}>
                          <Badge variant="outline">{t("billing.license.current")}</Badge>
                        </Show>
                        <Show when={row().value === String(best())}>
                          <Badge variant="outline">{t("settings.hostedServers.plan.recommended")}</Badge>
                        </Show>
                      </span>
                      <span class="storage-tier-option-price">{price(row().amount)}</span>
                    </RadioGroup.ItemLabel>
                  </RadioGroup.Item>
                )}
              </For>
            </RadioGroup.Root>
            <Show when={props.error}>
              {(error) => (
                <p class="storage-tier-error" role="alert">
                  {error()}
                </p>
              )}
            </Show>
            <footer class="hosted-upsell-modal-actions">
              <Button variant="ghost" disabled={props.pending} onClick={() => props.onClose()}>
                {props.mode === "offer" ? t("server.upsell.notNow") : t("common.cancel")}
              </Button>
              <Show when={props.mode === "offer" ? props.onFreeUpSpace : undefined}>
                {(freeUpSpace) => (
                  <Button variant="outline" disabled={props.pending} onClick={() => freeUpSpace()()}>
                    {t("sidebar.storage.freeUpSpace")}
                  </Button>
                )}
              </Show>
              <Show when={chosen()}>
                {(upgrade) => (
                  <Button
                    ref={(element) => (primary = element)}
                    loading={props.pending}
                    onClick={() => props.onBuy(upgrade().tier)}
                  >
                    {t("billing.storage.add", { size: gigabytes(upgrade().storageGb - props.storageGb) })}
                  </Button>
                )}
              </Show>
            </footer>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
