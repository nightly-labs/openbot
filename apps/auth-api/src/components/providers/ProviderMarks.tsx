import { AppLogo, ProviderLogo } from "@openbot/brand";
import { Show } from "solid-js";
import type { ProviderPage } from "../../content/providers/provider-page";
import { LandingIcon } from "../landing/LandingIcon";

export function ProviderMarks(props: { page: Pick<ProviderPage, "provider" | "name">; small?: boolean }) {
  return (
    <span class={props.small ? "compare-marks compare-marks-small" : "compare-marks"}>
      <span class="compare-mark">
        <AppLogo variant="production" animation={props.small ? "none" : "blink"} class="compare-mark-logo" />
        <Show when={!props.small}>
          <span class="compare-mark-name">OpenBot</span>
        </Show>
      </span>
      <span class="compare-vs">runs</span>
      <span class="compare-mark">
        <span class="compare-mark-logo provider-mark-frame">
          {props.page.provider === "custom" ? (
            <LandingIcon name="cpu" class="provider-mark-logo provider-mark-custom" />
          ) : (
            <ProviderLogo provider={props.page.provider} class="provider-mark-logo" />
          )}
        </span>
        <Show when={!props.small}>
          <span class="compare-mark-name">{props.page.name}</span>
        </Show>
      </span>
    </span>
  );
}
