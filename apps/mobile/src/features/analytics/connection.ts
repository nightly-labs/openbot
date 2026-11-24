import type { RemoteConnectionStage } from "@openbot/team-client";
import type { RemoteTeamDiagnostic } from "@openbot/team-client/remote-peer";
import type { PhoneVpnState } from "@/features/support/model/phone-network";
import type { MobileAnalytics } from "./analytics-core";

type StepTime = "signal_socket_ms" | "signal_ms" | "channels_ms" | "auth_ms";

const STEP_TIMES = new Map<RemoteTeamDiagnostic["step"], StepTime>([
  ["signal-open", "signal_socket_ms"],
  ["signal-ready", "signal_ms"],
  ["channels-open", "channels_ms"],
  ["authenticated", "auth_ms"],
]);

interface AttemptSteps {
  readonly started: number;
  readonly times: Partial<Record<StepTime, number>>;
  route?: string;
}

export class MobileConnectionAnalytics {
  private connected = false;
  private everConnected = false;
  private steps: AttemptSteps | null = null;

  constructor(
    private readonly analytics: MobileAnalytics,
    private readonly vpn: () => PhoneVpnState,
  ) {}

  attempt() {
    const scope = this.analytics.scope();
    const steps: AttemptSteps = { started: performance.now(), times: {} };
    this.steps = steps;
    const action = this.everConnected ? "reconnect" : "connect";
    return (result: "succeeded" | "failed", stage: RemoteConnectionStage) => {
      if (this.steps === steps) this.steps = null;
      if (result === "succeeded") {
        this.analytics.retryReports();
        this.connected = true;
        this.everConnected = true;
      }
      scope.track("mobile_connection_action", {
        action,
        result,
        stage,
        duration_ms: performance.now() - steps.started,
        ...steps.times,
        ...(steps.route ? { route: steps.route } : {}),
        vpn: this.vpn(),
        ...(result === "failed" ? { failure_code: "connection_failed" } : {}),
      });
    };
  }

  diagnostic(step: RemoteTeamDiagnostic["step"], detail: string | undefined): void {
    const steps = this.steps;
    if (!steps) return;
    if (step === "route") {
      if (detail) steps.route = detail;
      return;
    }
    const time = STEP_TIMES.get(step);
    if (time) steps.times[time] = performance.now() - steps.started;
  }

  lost(): void {
    if (!this.connected) return;
    this.connected = false;
    this.analytics.track("mobile_connection_action", {
      action: "lost",
      result: "failed",
      failure_code: "connection_failed",
      vpn: this.vpn(),
    });
  }

  background(): void {
    this.connected = false;
  }
}
