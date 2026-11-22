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

export const actionToast = {
  success: showOutcome("success"),
  warning: showOutcome("warning"),
  error: showOutcome("error"),
};
