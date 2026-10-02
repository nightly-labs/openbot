import { type ExternalToast, toast } from "@openbot/ui";
import { playActionSound } from "./action-sounds";

type ToastMessage = Parameters<typeof toast>[0];
type Outcome = "success" | "warning" | "error";

function showOutcome(outcome: Outcome) {
  return (message: ToastMessage, data?: ExternalToast): string | number => {
    playActionSound(outcome, { emphasis: "subtle" });
    return toast[outcome](message, data);
  };
}

/**
 * A toast that tells the result of an action that the user started. It plays the cue for that result,
 * soft. A toast that comes without a user action, such as an update offer or an error that a host
 * sends, uses `toast` and stays silent.
 */
export const actionToast = {
  success: showOutcome("success"),
  warning: showOutcome("warning"),
  error: showOutcome("error"),
};
