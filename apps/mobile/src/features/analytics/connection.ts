import type { RemoteConnectionStage } from "@openbot/team-client";
import type { MobileAnalytics } from "./analytics-core";

export class MobileConnectionAnalytics {
  private connected = false;
  private everConnected = false;
  constructor(private readonly analytics: MobileAnalytics) {}

  attempt() {
    const scope = this.analytics.scope();
    const started = performance.now();
    const action = this.everConnected ? "reconnect" : "connect";
    return (result: "succeeded" | "failed", stage: RemoteConnectionStage) => {
      if (result === "succeeded") {
        this.connected = true;
        this.everConnected = true;
      }
      scope.track("mobile_connection_action", {
        action,
        result,
        stage,
        duration_ms: performance.now() - started,
        ...(result === "failed" ? { failure_code: "connection_failed" } : {}),
      });
    };
  }

  lost(): void {
    if (!this.connected) return;
    this.connected = false;
    this.analytics.track("mobile_connection_action", {
      action: "lost",
      result: "failed",
      failure_code: "connection_failed",
    });
  }

  background(): void {
    this.connected = false;
  }
}
