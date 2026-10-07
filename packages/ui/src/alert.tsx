import type { FailureProperties, NotificationMetadata } from "@openbot/telemetry";
import type { JSX } from "@solidjs/web";
import { createContext, createEffect, omit, useContext } from "solid-js";
import { cx } from "./utils";

export type AlertTone = "neutral" | "success" | "warning" | "danger";

export interface AlertProps extends JSX.HTMLAttributes<HTMLDivElement> {
  tone?: AlertTone;
  report?: NotificationMetadata | false;
}

const NotificationContext = createContext<((report: FailureProperties) => void) | null>(null);

/** Applications observe presentations. The shared UI does not send or store reports. */
export function NotificationObserver(props: {
  onShown: (report: FailureProperties) => void;
  children?: JSX.Element;
}): JSX.Element {
  return <NotificationContext value={props.onShown}>{props.children}</NotificationContext>;
}

export function Alert(props: AlertProps): JSX.Element {
  const observe = useContext(NotificationContext);
  createEffect(
    () => props.tone,
    (tone) => {
      if (props.report === false || (tone !== "danger" && tone !== "warning")) return;
      observe?.({
        ...(props.report ?? { operation: "other", source: "system", cause_code: "unknown" }),
        severity: tone === "danger" ? "error" : "warning",
        presentation: "banner",
      });
    },
  );
  const others = omit(props, "class", "tone", "report");
  return <div class={cx("ui-alert", props.class)} data-tone={props.tone ?? "neutral"} {...others} />;
}

export function AlertIcon(props: JSX.HTMLAttributes<HTMLSpanElement>): JSX.Element {
  const others = omit(props, "class");
  return <span class={cx("ui-alert-icon", props.class)} aria-hidden="true" {...others} />;
}

export function AlertContent(props: JSX.HTMLAttributes<HTMLDivElement>): JSX.Element {
  const others = omit(props, "class");
  return <div class={cx("ui-alert-content", props.class)} {...others} />;
}

export function AlertTitle(props: JSX.HTMLAttributes<HTMLElement>): JSX.Element {
  const others = omit(props, "class");
  return <strong class={cx("ui-alert-title", props.class)} {...others} />;
}

export function AlertDescription(props: JSX.HTMLAttributes<HTMLSpanElement>): JSX.Element {
  const others = omit(props, "class");
  return <span class={cx("ui-alert-description", props.class)} {...others} />;
}

export function AlertActions(props: JSX.HTMLAttributes<HTMLDivElement>): JSX.Element {
  const others = omit(props, "class");
  return <div class={cx("ui-alert-actions", props.class)} {...others} />;
}
