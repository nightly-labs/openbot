import type { MobileAnalytics, MobileAnalyticsScope } from "./analytics-core";

/** One outcome per visible visit, including reads from the local conversation cache. */
export class MobileConversationAnalytics {
  private visit: { scope: MobileAnalyticsScope; started: number; reported: boolean } | null = null;
  constructor(private readonly analytics: MobileAnalytics) {}

  update(visible: boolean, readable: boolean, failed: boolean): void {
    if (!visible) {
      this.visit = null;
      return;
    }
    this.visit ??= { scope: this.analytics.scope(), started: performance.now(), reported: false };
    if (this.visit.reported || (!readable && !failed)) return;
    this.visit.reported = true;
    this.visit.scope.track("conversation_opened", {
      result: readable ? "succeeded" : "failed",
      duration_ms: performance.now() - this.visit.started,
      ...(readable ? {} : { failure_code: "load_failed" }),
    });
  }
}
