import { ProviderLogo } from "@openbot/brand";
import { Button, Gauge, RefreshCw } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createSignal, For, onCleanup, Show } from "solid-js";
import { useText } from "../../text";
import { type AccountUsageProviderRow, accountUsageRowLabel, formatUsageResetIn } from "./account-usage-view";

/** The reset countdown shows minutes, so a half-minute tick keeps it current. */
const RESET_CLOCK_MS = 30_000;

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
  const [now, setNow] = createSignal(Date.now());
  const clock = window.setInterval(() => setNow(Date.now()), RESET_CLOCK_MS);
  onCleanup(() => window.clearInterval(clock));
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
                  when={row.windows.length > 0}
                  fallback={
                    <>
                      <span class="account-usage-provider-copy">
                        <strong class="account-usage-provider-name">{row.name}</strong>
                        <span class="account-usage-provider-meta">
                          {!row.reportsUsage
                            ? t("account.usage.providerNotReported")
                            : props.loading
                              ? t("account.usage.window.limit")
                              : t("account.usage.notReported")}
                        </span>
                      </span>
                      <strong class="account-usage-provider-remaining">
                        {!row.reportsUsage
                          ? t("account.usage.value.notReported")
                          : props.loading
                            ? t("account.usage.value.loading")
                            : t("account.usage.value.unavailable")}
                      </strong>
                    </>
                  }
                >
                  <strong class="account-usage-provider-name">{row.name}</strong>
                  <span class="account-usage-windows">
                    <For each={row.windows}>
                      {(usageWindow) => (
                        <span class="account-usage-window" data-usage-tone={usageWindow.tone}>
                          <span class="account-usage-window-label">{usageWindow.label}</span>
                          <span class="account-usage-window-bar" aria-hidden="true">
                            <span
                              class="account-usage-window-fill"
                              style={{ "inline-size": `${usageWindow.remainingPercent}%` }}
                            />
                          </span>
                          <strong class="account-usage-window-remaining">
                            {text.format.percent(usageWindow.remainingPercent / 100)}
                          </strong>
                          <span
                            class="account-usage-window-reset"
                            title={
                              usageWindow.resetsAtLabel
                                ? t("account.usage.resetsAt", { time: usageWindow.resetsAtLabel })
                                : undefined
                            }
                          >
                            {formatUsageResetIn(usageWindow.resetsAt, now(), text)}
                          </span>
                        </span>
                      )}
                    </For>
                  </span>
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
