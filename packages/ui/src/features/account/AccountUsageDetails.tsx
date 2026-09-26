import { ProviderLogo } from "@openbot/brand";
import { Button, Gauge, RefreshCw } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import { useText } from "../../text";
import { type AccountUsageProviderRow, accountUsageRowLabel } from "./account-usage-view";

export function AccountUsageDetails(props: {
  rows: AccountUsageProviderRow[];
  loading: boolean;
  error: string | null;
  refreshActive: boolean;
  refreshDisabled: boolean;
  onRefresh: () => void;
  title: JSX.Element;
}) {
  const text = useText();
  const { t } = text;
  const empty = () => !props.loading && props.rows.length === 0;
  return (
    <>
      <header class="account-usage-popover-header">
        <div class="account-usage-popover-heading">
          <Gauge aria-hidden="true" />
          {props.title}
        </div>
        <Button
          variant="ghost"
          type="button"
          size="icon-sm"
          class="account-usage-refresh"
          aria-label={
            props.refreshActive
              ? t("account.usage.refreshing")
              : props.error
                ? t("common.tryAgain")
                : t("account.usage.refresh")
          }
          title={t("account.usage.refreshTitle")}
          onClick={props.onRefresh}
          disabled={props.refreshDisabled}
        >
          <RefreshCw class={props.refreshActive ? "account-menu-icon-spinning" : undefined} aria-hidden="true" />
        </Button>
      </header>
      <Show when={props.loading && props.rows.length === 0}>
        <p class="account-usage-empty" role="status">
          {t("account.usage.loading")}
        </p>
      </Show>
      <Show when={empty()}>
        <p class="account-usage-empty" role="status">
          {t("account.usage.empty")}
        </p>
      </Show>
      <Show when={props.rows.length > 0}>
        <ul class="account-usage-providers" aria-label={t("account.usage.providers")}>
          <For each={props.rows}>
            {(row) => (
              <li
                class="account-usage-provider"
                data-usage-tone={row.tone}
                aria-label={accountUsageRowLabel(row, text)}
              >
                <ProviderLogo provider={row.provider} class="account-usage-provider-logo" />
                <span class="account-usage-provider-copy">
                  <strong class="account-usage-provider-name">{row.name}</strong>
                  <span class="account-usage-provider-meta">
                    {row.windowLabel ?? t("account.usage.window.limit")}
                    <Show when={row.resetsAtLabel}>{(label) => <> · {label()}</>}</Show>
                  </span>
                </span>
                <strong class="account-usage-provider-remaining">
                  {row.remainingPercent === null
                    ? "—"
                    : t("account.usage.percentLeft", { percent: row.remainingPercent })}
                </strong>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <Show when={props.error}>{(message) => <p class="account-usage-popover-error">{message()}</p>}</Show>
    </>
  );
}
