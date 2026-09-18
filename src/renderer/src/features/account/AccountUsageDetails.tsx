import { ProviderLogo } from "@openbot/brand";
import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import { Button, Gauge, RefreshCw } from "../../components/ui";
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
          aria-label={props.refreshActive ? "Refreshing" : props.error ? "Try again" : "Refresh"}
          title="Refresh usage"
          onClick={props.onRefresh}
          disabled={props.refreshDisabled}
        >
          <RefreshCw class={props.refreshActive ? "account-menu-icon-spinning" : undefined} aria-hidden="true" />
        </Button>
      </header>
      <Show when={props.loading && props.rows.length === 0}>
        <p class="account-usage-empty" role="status">
          Loading usage…
        </p>
      </Show>
      <Show when={empty()}>
        <p class="account-usage-empty" role="status">
          No usage to show
        </p>
      </Show>
      <Show when={props.rows.length > 0}>
        <ul class="account-usage-providers" aria-label="Provider usage">
          <For each={props.rows}>
            {(row) => (
              <li class="account-usage-provider" data-usage-tone={row.tone} aria-label={accountUsageRowLabel(row)}>
                <ProviderLogo provider={row.provider} class="account-usage-provider-logo" />
                <span class="account-usage-provider-copy">
                  <strong class="account-usage-provider-name">{row.name}</strong>
                  <span class="account-usage-provider-meta">
                    {row.windowLabel ?? "Limit"}
                    <Show when={row.resetsAtLabel}>{(label) => <> · {label()}</>}</Show>
                  </span>
                </span>
                <strong class="account-usage-provider-remaining">
                  {row.remainingPercent === null ? "—" : `${row.remainingPercent}% left`}
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
