import type { NearDepositAddress, NearDepositAsset } from "@openbot/contracts/ipc";
import { CopyButton, Label, QrCode, SearchSelect, Spinner, Text } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createEffect, createMemo, createSignal, createUniqueId, Show } from "solid-js";
import { useText } from "../../text";
import { ChainLogo, TokenLogo } from "./crypto-logo";
import {
  chainName,
  DEFAULT_DEPOSIT_COIN,
  type NearDepositCoin,
  nearDepositCoins,
  networkDetail,
} from "./near-deposit-coins";
import { NearFailure } from "./near-wallet-parts";

function CoinRow(props: { coin: NearDepositCoin }): JSX.Element {
  return (
    <span class="near-wallet-pick-row">
      <TokenLogo symbol={props.coin.symbol} />
      <span class="near-wallet-pick-name">{props.coin.symbol}</span>
    </span>
  );
}

function NetworkRow(props: { coin: NearDepositCoin; asset: NearDepositAsset }): JSX.Element {
  return (
    <span class="near-wallet-pick-row">
      <ChainLogo blockchain={props.asset.blockchain} />
      <span class="near-wallet-pick-name">{chainName(props.asset.blockchain)}</span>
      <Show when={networkDetail(props.coin, props.asset)}>
        {(detail) => <span class="near-wallet-pick-detail">{detail()}</span>}
      </Show>
    </span>
  );
}

function CopyText(props: { label: string; value: string }): JSX.Element {
  return (
    <div class="near-wallet-copy">
      <Text variant="caption" tone="muted">
        {props.label}
      </Text>
      <p class="near-wallet-copy-value">{props.value}</p>
      <CopyButton value={props.value} size="sm" variant="outline" />
    </div>
  );
}

export function AddFundsFields(props: {
  assets: readonly NearDepositAsset[];
  deposit: (assetId: string) => Promise<NearDepositAddress>;
}): JSX.Element {
  const { t, errorMessage } = useText();
  const id = createUniqueId();
  const coins = createMemo(() => nearDepositCoins(props.assets));
  const [assetId, setAssetId] = createSignal<string | null>(null);
  const [address, setAddress] = createSignal<NearDepositAddress | null>(null);
  const [failure, setFailure] = createSignal<string | null>(null);
  let root: HTMLDivElement | undefined;
  const popupMount = () => root?.closest("[role=dialog],[role=alertdialog]") ?? undefined;
  const fallbackCoin = () => coins().find((coin) => coin.symbol === DEFAULT_DEPOSIT_COIN) ?? coins()[0];
  const coin = () =>
    coins().find((item) => item.networks.some((asset) => asset.assetId === assetId())) ?? fallbackCoin();
  const asset = () => {
    const current = coin();
    return current?.networks.find((item) => item.assetId === assetId()) ?? current?.networks[0];
  };
  createEffect(
    () => asset()?.assetId,
    (current) => {
      if (!current) return;
      let live = true;
      setAddress(null);
      setFailure(null);
      props.deposit(current).then(
        (result) => {
          if (live) setAddress(result);
        },
        (error: unknown) => {
          if (live) setFailure(errorMessage(error, t("vault.near.failed")));
        },
      );
      return () => {
        live = false;
      };
    },
  );
  return (
    <Show when={coin()}>
      {(currentCoin) => (
        <Show when={asset()}>
          {(current) => (
            <div class="near-wallet-funds" ref={root}>
              <div class="near-wallet-funds-pick">
                <div class="ui-field">
                  <Label id={`${id}-coin`}>{t("vault.near.coin")}</Label>
                  <SearchSelect<NearDepositCoin>
                    options={coins()}
                    value={currentCoin()}
                    optionValue={(item) => item.symbol}
                    label={(item) => item.symbol}
                    itemContent={(item) => <CoinRow coin={item} />}
                    mount={popupMount()}
                    aria-labelledby={`${id}-coin ${id}-coin-value`}
                    onChange={(item) => setAssetId(item.networks[0]?.assetId ?? null)}
                  >
                    <span id={`${id}-coin-value`} class="ui-select-value">
                      <CoinRow coin={currentCoin()} />
                    </span>
                  </SearchSelect>
                </div>
                <div class="ui-field">
                  <Label id={`${id}-network`}>{t("vault.near.network")}</Label>
                  <SearchSelect<NearDepositAsset>
                    options={currentCoin().networks}
                    value={current()}
                    optionValue={(item) => item.assetId}
                    label={(item) => chainName(item.blockchain)}
                    optionTextValue={(item) => `${chainName(item.blockchain)} ${item.blockchain}`}
                    itemContent={(item) => <NetworkRow coin={currentCoin()} asset={item} />}
                    disabled={currentCoin().networks.length < 2}
                    mount={popupMount()}
                    aria-labelledby={`${id}-network ${id}-network-value`}
                    onChange={(item) => setAssetId(item.assetId)}
                  >
                    <span id={`${id}-network-value`} class="ui-select-value">
                      <NetworkRow coin={currentCoin()} asset={current()} />
                    </span>
                  </SearchSelect>
                </div>
              </div>
              <NearFailure text={failure()} />
              <Show
                when={address()}
                fallback={
                  <Show when={!failure()}>
                    <div class="near-wallet-deposit near-wallet-deposit-loading" role="status">
                      <Spinner />
                    </div>
                  </Show>
                }
              >
                {(deposit) => (
                  <>
                    <div class="near-wallet-deposit">
                      <QrCode
                        value={deposit().address}
                        size={160}
                        label={t("vault.near.depositQr", { symbol: current().symbol })}
                      >
                        <TokenLogo symbol={current().symbol} class="near-wallet-qr-mark" />
                      </QrCode>
                      <div class="near-wallet-deposit-fields">
                        <CopyText
                          label={t("vault.near.addressOn", {
                            symbol: current().symbol,
                            chain: chainName(current().blockchain),
                          })}
                          value={deposit().address}
                        />
                        <Show when={deposit().memo}>
                          {(memo) => <CopyText label={t("vault.near.memo")} value={memo()} />}
                        </Show>
                      </div>
                    </div>
                    <Text variant="caption" tone="muted">
                      {t("vault.near.onlyAsset", { symbol: current().symbol, chain: chainName(current().blockchain) })}
                      <Show when={deposit().minAmount}>
                        {(amount) => <> {t("vault.near.minimum", { amount: amount(), symbol: current().symbol })}</>}
                      </Show>
                    </Text>
                  </>
                )}
              </Show>
            </div>
          )}
        </Show>
      )}
    </Show>
  );
}
