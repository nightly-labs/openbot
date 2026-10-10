import { classifyFailure, type FailureProperties, type NotificationMetadata } from "@openbot/telemetry";
import { errorReference } from "@openbot/user-errors";
import type { ComponentProps, JSX } from "@solidjs/web";
import { createEffect, createSignal, omit, onSettled } from "solid-js";
import {
  Toaster as Sonner,
  type ExternalToast as SonnerExternalToast,
  toast as sonnerToast,
  useSonner,
} from "solid-sonner";
import { ErrorReference } from "./error-reference";
import { CircleCheck, Info, LoaderCircle, OctagonX, TriangleAlert } from "./icons";
import { currentText } from "./text";
import { cx } from "./utils";

export type ToasterProps = ComponentProps<typeof Sonner> & {
  onToastShown?: (metadata: FailureProperties) => void;
};
export type ExternalToast = SonnerExternalToast & {
  report?: NotificationMetadata;
  /**
   * The failure the toast reports. The toast shows its code under the description, so a user can
   * copy it. Without a `description`, the toast shows `errorMessage(error, fallback)`.
   */
  error?: unknown;
  /** The translated sentence for an `error` with no readable message of its own. */
  fallback?: string;
};
const reports = new Map<string | number, NotificationMetadata>();
const shown = new Set<string | number>();
let promiseId = 0;
function rememberReport(id: string | number, report: NotificationMetadata): void {
  reports.set(id, report);
  while (reports.size > 1_000) {
    const oldest = reports.keys().next();
    if (oldest.done) break;
    reports.delete(oldest.value);
  }
}
function outcomeToast(kind: "error" | "warning") {
  return (message: Parameters<typeof sonnerToast>[0], options?: ExternalToast) => {
    const { report, error, fallback, ...data } = options ?? {};
    if (error !== undefined) data.description = withReference(error, data.description, fallback);
    const id = sonnerToast[kind](message, data);
    if (report) rememberReport(id, report);
    return id;
  };
}
function withReference(
  error: unknown,
  description: SonnerExternalToast["description"],
  fallback: string | undefined,
): SonnerExternalToast["description"] {
  const reference = errorReference(error);
  const text = description ?? (fallback === undefined ? undefined : currentText().errorMessage(error, fallback));
  if (!reference) return text;
  return () => (
    <>
      {typeof text === "function" ? text() : text}
      <ErrorReference reference={reference} />
    </>
  );
}

function promiseToast<T>(
  promise: Parameters<typeof sonnerToast.promise<T>>[0],
  data?: Parameters<typeof sonnerToast.promise<T>>[1] & { report?: NotificationMetadata },
) {
  if (!data) return sonnerToast.promise(promise, data);
  const { report, ...options } = data;
  const id = options.id ?? `openbot-promise-${++promiseId}`;
  const failed = (error: unknown): never => {
    rememberReport(id, {
      operation: report?.operation ?? "other",
      source: report?.source ?? "action",
      cause_code: classifyFailure(error),
    });
    throw error;
  };
  return sonnerToast.promise(typeof promise === "function" ? () => promise().catch(failed) : promise.catch(failed), {
    ...options,
    id,
  });
}
export const toast = Object.assign((...args: Parameters<typeof sonnerToast>) => sonnerToast(...args), sonnerToast, {
  error: outcomeToast("error"),
  warning: outcomeToast("warning"),
  promise: promiseToast,
});

/** Toast lifetime; exported so manual timers settle on the same count. */
export const TOAST_DURATION = 6_000;

const [hasVisibleToasts, setHasVisibleToasts] = createSignal(false);

export function Toaster(props: ToasterProps): JSX.Element {
  // The desktop app mounts the Toaster outside its text provider, so it follows the active locale.
  const { t } = currentText();
  const notifications = useSonner();
  const sonnerProps = omit(props, "onToastShown");
  createEffect(
    () => notifications.toasts(),
    (toasts) => {
      if (!props.onToastShown) return;
      const current = new Set(sonnerToast.getToasts().map((item) => item.id));
      for (const id of shown)
        if (!current.has(id)) {
          shown.delete(id);
          reports.delete(id);
        }
      const visibleCounts = new Map<string, number>();
      for (const item of toasts) {
        if (item.toasterId !== props.id) continue;
        const position = item.position ?? props.position ?? "top-right";
        const count = visibleCounts.get(position) ?? 0;
        visibleCounts.set(position, count + 1);
        if (count >= (props.visibleToasts ?? 6)) continue;
        if (item.delete || (item.type !== "error" && item.type !== "warning") || shown.has(item.id)) continue;
        shown.add(item.id);
        props.onToastShown?.({
          ...(reports.get(item.id) ?? { operation: "other", source: "system", cause_code: "unknown" }),
          severity: item.type,
          presentation: "toast",
        });
      }
    },
  );
  let layer: HTMLDivElement | undefined;
  onSettled(() => {
    if (!layer) return;
    const updateVisibility = () => {
      setHasVisibleToasts(Boolean(layer?.querySelector("[data-sonner-toast]")));
      // solid-sonner renders the close button, so mark it here for the close cue.
      for (const button of layer?.querySelectorAll("[data-close-button]:not([data-cuelume-close])") ?? []) {
        button.setAttribute("data-cuelume-close", "");
        button.setAttribute("data-cuelume-emphasis", "subtle");
      }
    };
    // Track mounted toasts so native content stays behind their exit animation too.
    const observer = new MutationObserver(updateVisibility);
    observer.observe(layer, { childList: true, subtree: true });
    updateVisibility();
    return () => {
      observer.disconnect();
      setHasVisibleToasts(false);
    };
  });
  return (
    <div ref={layer} data-kb-top-layer="" class="ui-toast-layer">
      <Sonner
        {...sonnerProps}
        class={cx("ui-toaster", (props.closeButton ?? true) && "ui-toaster-closeable", props.class)}
        theme={props.theme ?? "dark"}
        position={props.position ?? "top-right"}
        // A toast past the visible count stays hidden even when hover expands the stack, so an update
        // offer would wait behind another. Six providers can offer an update at once.
        visibleToasts={props.visibleToasts ?? 6}
        duration={props.duration ?? TOAST_DURATION}
        gap={props.gap ?? 8}
        richColors={props.richColors ?? false}
        closeButton={props.closeButton ?? true}
        pauseWhenPageIsHidden={props.pauseWhenPageIsHidden ?? true}
        containerAriaLabel={props.containerAriaLabel ?? t("notification.toast.region")}
        toastOptions={{ closeButtonAriaLabel: t("notification.toast.close"), ...props.toastOptions }}
        icons={{
          success: <CircleCheck class="ui-toast-icon" aria-hidden="true" />,
          info: <Info class="ui-toast-icon" aria-hidden="true" />,
          warning: <TriangleAlert class="ui-toast-icon" aria-hidden="true" />,
          error: <OctagonX class="ui-toast-icon" aria-hidden="true" />,
          loading: <LoaderCircle class="ui-toast-icon ui-toast-loading-icon" aria-hidden="true" />,
          ...props.icons,
        }}
      />
    </div>
  );
}

export type { ToastT } from "solid-sonner";
export { hasVisibleToasts };
