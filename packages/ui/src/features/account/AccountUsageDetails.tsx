import { ProviderLogo } from "@openbot/brand";
import { Button, Gauge, Progress, RefreshCw } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import { useText } from "../../text";
import {
  type AccountUsageProviderRow,
  type AccountUsageWindowRow,
  accountUsageRowLabel,
  accountUsageWindowLabel,
} from "./account-usage-view";

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
                aria-label={accountUsageRowLabel(row, text, props.loading)}
              >
                <ProviderLogo provider={row.provider} class="account-usage-provider-logo" />
                <Show
                  when={row.windows.length > 0 || row.credits.length > 0}
                  fallback={
                    <>
                      <span class="account-usage-provider-copy">
                        <strong class="account-usage-provider-name">{row.name}</strong>
                        <span class="account-usage-provider-meta">
                          {row.windowLabel ??
                            (props.loading ? t("account.usage.window.limit") : t("account.usage.notReported"))}
                          <Show when={row.resetsAtLabel}>{(label) => <> · {label()}</>}</Show>
                        </span>
                      </span>
                      <strong class="account-usage-provider-remaining">
                        {row.remainingPercent !== null
                          ? t("account.usage.percentLeft", { percent: row.remainingPercent })
                          : props.loading
                            ? t("account.usage.value.loading")
                            : t("account.usage.value.unavailable")}
                      </strong>
                    </>
                  }
                >
                  <strong class="account-usage-provider-name">{row.name}</strong>
                  <ul class="account-usage-windows">
                    <For each={row.windows}>{(window) => <UsageWindow window={window} />}</For>
                    <For each={row.credits}>
                      {(credit) => (
                        <li class="account-usage-window account-usage-credit">
                          <span class="account-usage-window-label">{credit.label}</span>
                          <strong class="account-usage-window-remaining">{credit.value}</strong>
                        </li>
                      )}
                    </For>
                  </ul>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <Show when={props.error}>{(message) => <p class="account-usage-popover-error">{message()}</p>}</Show>
    </>
  );
}

function UsageWindow(props: { window: AccountUsageWindowRow }) {
  const text = useText();
  const { t } = text;
  return (
    <li
      class="account-usage-window"
      data-usage-tone={props.window.tone}
      aria-label={accountUsageWindowLabel(props.window, text)}
    >
      <span class="account-usage-window-label">{props.window.label}</span>
      <strong class="account-usage-window-remaining">
        {t("account.usage.percentLeft", { percent: props.window.remainingPercent })}
      </strong>
      <Progress class="account-usage-window-bar" value={props.window.remainingPercent} aria-hidden="true" />
      <Show when={props.window.detail || props.window.resetsAtLabel}>
        <span class="account-usage-window-meta">
          <Show when={props.window.detail}>
            {(detail) => <span class="account-usage-window-detail">{detail()}</span>}
          </Show>
          <Show when={props.window.resetsAtLabel}>
            {(reset) => <span class="account-usage-window-reset">{reset()}</span>}
          </Show>
        </span>
      </Show>
    </li>
  );
}
