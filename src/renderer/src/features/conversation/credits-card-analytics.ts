import type { CreditsHoldControls } from "@openbot/ui/features/conversation/CreditsHoldCard";
import type { MediaApprovalControls } from "@openbot/ui/features/conversation/MediaApprovalCard";
import { type DesktopAnalyticsProperties, desktopAnalytics } from "../../analytics";

type CreditsCardEvent = DesktopAnalyticsProperties<"credits_card_action">;
type CreditsCardServerKind = CreditsCardEvent["server_kind"];
type CreditsCardStep = Omit<CreditsCardEvent, "result" | "failure_code">;

async function trackedStep<T>(
  step: CreditsCardStep,
  run: () => Promise<T>,
  details: (value: T) => Pick<CreditsCardEvent, "still_short"> = () => ({}),
): Promise<T> {
  const analytics = desktopAnalytics.scope();
  try {
    const value = await run();
    analytics.track(
      "credits_card_action",
      value === false
        ? { ...step, result: "failed", failure_code: "response_failed" }
        : { ...step, ...details(value), result: "succeeded" },
    );
    return value;
  } catch (error) {
    analytics.track("credits_card_action", { ...step, result: "failed", failure_code: "response_failed" });
    throw error;
  }
}

function trackedCreditsHold(hold: CreditsHoldControls, serverKind: () => CreditsCardServerKind): CreditsHoldControls {
  return {
    ...hold,
    buy: () => {
      desktopAnalytics.track("credits_card_action", {
        card: "hold",
        action: "buy",
        server_kind: serverKind(),
        result: "succeeded",
      });
      hold.buy();
    },
    respond: (approval, action) =>
      trackedStep(
        { card: "hold", action, server_kind: serverKind() },
        () => hold.respond(approval, action),
        (still) => (action === "continue" || action === "enable" ? { still_short: still !== null } : {}),
      ),
    unmute: () => trackedStep({ card: "hold", action: "unmute", server_kind: serverKind() }, () => hold.unmute()),
  };
}

export function trackedMediaApproval(
  controls: MediaApprovalControls,
  serverKind: () => CreditsCardServerKind,
): MediaApprovalControls {
  const { setDefault, hold } = controls;
  return {
    ...controls,
    allow: (approval, choice) =>
      trackedStep({ card: "approval", action: "allow", server_kind: serverKind() }, () =>
        controls.allow(approval, choice),
      ),
    setDefault:
      setDefault &&
      ((kind, model) =>
        trackedStep({ card: "approval", action: "set_default", server_kind: serverKind(), media_kind: kind }, () =>
          setDefault(kind, model),
        )),
    hold: hold && trackedCreditsHold(hold, serverKind),
  };
}
