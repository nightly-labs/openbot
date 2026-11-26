import type { AppTextKey } from "@openbot/i18n";
import { classifyFailure } from "@openbot/telemetry";
import type { ConnectorDetail } from "@openbot/ui/features/connectors/ConnectorDetailPanel";
import type { ConnectorId } from "@openbot/ui/features/connectors/connectors";
import { currentText } from "@openbot/ui/text";
import { createSignal, onCleanup } from "solid-js";
import { actionToast } from "../../action-toast";
import { type DesktopAnalyticsProperties, desktopAnalytics } from "../../analytics";

export type ConnectorAnalyticsAction = DesktopAnalyticsProperties<"connector_action">["action"];

export interface ConnectorController {
  readonly id: ConnectorId;
  ready: () => boolean;
  available: () => boolean;
  busy: () => boolean;
  readonly detail: ConnectorDetail;
  readonly connect?: (() => void) | undefined;
  reload: () => void;
  watch: () => () => void;
}

export const NO_WATCH = () => () => undefined;

export function createConnectorActions(failed: AppTextKey, connector: ConnectorId) {
  const [busy, setBusy] = createSignal(false);
  let attempt = 0;
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });
  const report = (error: unknown) => {
    const { t, errorMessage } = currentText();
    actionToast.error(t(failed), {
      description: errorMessage(error, t(failed)),
      report: { operation: "other", source: "action", cause_code: classifyFailure(error) },
    });
  };
  const run = <T>(
    action: () => Promise<T>,
    options: {
      waits?: boolean;
      done?: (result: T) => void;
      settled?: () => void;
      track?: ConnectorAnalyticsAction;
    } = {},
  ) => {
    const waits = options.waits ?? true;
    if (waits && busy()) return;
    const current = ++attempt;
    setBusy(waits);
    const track = options.track;
    void action()
      .then((result) => {
        if (track) desktopAnalytics.track("connector_action", { connector, action: track, result: "succeeded" });
        if (!disposed && current === attempt) options.done?.(result);
      })
      .catch((error: unknown) => {
        if (track) desktopAnalytics.track("connector_action", { connector, action: track, result: "failed" });
        if (disposed || current !== attempt) return;
        report(error);
      })
      .finally(() => {
        if (disposed || current !== attempt) return;
        setBusy(false);
        options.settled?.();
      });
  };
  return { busy, run, report, disposed: () => disposed };
}
