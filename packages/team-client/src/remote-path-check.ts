export interface ProbeArm {
  at: number;
  rttMs: number | null;
  bytesSent: number;
  bytesReceived: number;
  rpcBuffered: number;
  probeBytes: number;
  fresh: boolean;
  limitMs: number;
}

export interface ProbeSample {
  at: number;
  bytesSent: number;
  bytesReceived: number;
}

export type PathVerdict =
  | { kind: "pending"; recheckAt: number }
  | { kind: "dead"; reason: "send-stalled" | "no-answer" };

export const PATH_CHECK_INTERVAL_MS = 1_000;
const STALL_CHECKS = 2;
const ANSWER_RTT_FACTOR = 3;
const ANSWER_MARGIN_MS = 500;
const MIN_ANSWER_MS = 1_500;
const MAX_ANSWER_MS = 4_000;
const FRESH_PEER_ANSWER_MS = 10_000;
const PROBE_DEADLINE_MS = 12_000;
const BUSY_HOST_DEADLINE_MS = 60_000;

function probeLeft(arm: ProbeArm, now: ProbeSample): boolean {
  return now.bytesSent - arm.bytesSent >= arm.rpcBuffered + arm.probeBytes;
}

export function judgePath(arm: ProbeArm, earlier: readonly ProbeSample[], now: ProbeSample): PathVerdict {
  const deadline = arm.at + Math.min(PROBE_DEADLINE_MS, arm.limitMs);
  const left = [...earlier, now].find((sample) => probeLeft(arm, sample));
  if (left) {
    const hostSends = now.bytesReceived > arm.bytesReceived;
    const answerBy = hostSends
      ? arm.at + Math.min(BUSY_HOST_DEADLINE_MS, arm.limitMs)
      : Math.min(deadline, left.at + answerWindowMs(arm));
    if (now.at >= answerBy) return { kind: "dead", reason: "no-answer" };
    return { kind: "pending", recheckAt: Math.min(answerBy, now.at + PATH_CHECK_INTERVAL_MS) };
  }
  const reads = [arm, ...earlier, now];
  const stallStart = reads[reads.length - 1 - STALL_CHECKS];
  if (now.at >= deadline || (stallStart && now.bytesSent - stallStart.bytesSent < arm.probeBytes))
    return { kind: "dead", reason: "send-stalled" };
  return { kind: "pending", recheckAt: Math.min(deadline, now.at + PATH_CHECK_INTERVAL_MS) };
}

export function unmeasuredProbeMs(fresh: boolean) {
  return fresh ? FRESH_PEER_ANSWER_MS : MAX_ANSWER_MS;
}

function answerWindowMs(arm: ProbeArm): number {
  if (arm.fresh) return FRESH_PEER_ANSWER_MS;
  if (arm.rttMs === null) return MAX_ANSWER_MS;
  return Math.min(MAX_ANSWER_MS, Math.max(MIN_ANSWER_MS, ANSWER_RTT_FACTOR * arm.rttMs + ANSWER_MARGIN_MS));
}
