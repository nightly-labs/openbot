import { AppState } from "react-native";

let reached = AppState.currentState !== "background";

export function untilForeground(): Promise<void> {
  if (reached || AppState.currentState === "active") {
    reached = true;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      reached = true;
      subscription.remove();
      resolve();
    });
  });
}
