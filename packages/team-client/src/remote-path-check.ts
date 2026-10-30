/**
 * The verdict of the compatibility probe that tells if a kept peer still reaches its host. The
 * probe waits only while the phone still sends it. Received bytes and ICE consent answers do not
 * extend the wait: the host keeps both alive for a session that it no longer answers, and the
 * phone's own send queue can hold the probe for a minute after a return to the foreground.
 */

/** The path and the rpc channel just before the probe was queued. */
export interface ProbeArm {
  at: number;
  /** The round-trip time of the selected pair, or null before ICE measured one. */
  rttMs: number | null;
  /** The bytes that the selected pair sent until now. */
  bytesSent: number;
  /** The data bytes that the selected pair received until now. */
  bytesReceived: number;
  /** The bytes in the rpc channel ahead of the probe. */
  rpcBuffered: number;
  probeBytes: number;
  /** No request was answered on this peer yet, so its SCTP association is cold. */
  fresh: boolean;
  /** The caller's request timeout. The probe never waits longer. */
  limitMs: number;
}

/** A later read of the selected pair. */
export interface ProbeSample {
  at: number;
  bytesSent: number;
  /** Data bytes from the host. ICE consent answers are not in this count. */
  bytesReceived: number;
}

export type PathVerdict =
  | { kind: "pending"; recheckAt: number }
  | { kind: "dead"; reason: "send-stalled" | "no-answer" };

/** The interval between two reads of the selected pair. */
export const PATH_CHECK_INTERVAL_MS = 1_000;
/** A probe that is still queued after this many reads with no send progress cannot leave in time. */
const STALL_CHECKS = 2;
/** A healthy path answers within three round trips and a margin for the host to read the request. */
const ANSWER_RTT_FACTOR = 3;
const ANSWER_MARGIN_MS = 500;
const MIN_ANSWER_MS = 1_500;
const MAX_ANSWER_MS = 4_000;
/**
 * The first answer on a new peer takes 6-7 round trips on a cold SCTP association: 4.2-5.2 s on a
 * TURN path at 770 ms RTT. A shorter wait would replace every new peer on such a path.
 */
const FRESH_PEER_ANSWER_MS = 10_000;
/** No queued probe waits longer, so a stale peer is replaced in seconds and not after a minute. */
const PROBE_DEADLINE_MS = 12_000;
/**
 * A host whose main process is busy answers late, while its WebRTC process still sends data. A probe
 * that has left the phone waits this long in total while data arrives, so a busy host does not cause
 * a reconnect loop (#1954).
 */
const BUSY_HOST_DEADLINE_MS = 60_000;

/** The probe has left the phone once everything queued ahead of it, plus itself, has been sent. */
function probeLeft(arm: ProbeArm, now: ProbeSample): boolean {
  return now.bytesSent - arm.bytesSent >= arm.rpcBuffered + arm.probeBytes;
}

/**
 * dead/send-stalled: the probe is still queued, and the path sent less than one probe frame across
 * the last two checks. The phone acknowledges the data that it receives, so a path that sends
 * nothing of its own still sends about 0.5 KB/s; a strict zero would never match.
 * dead/no-answer: the probe left, and no answer came within the answer window after it left. When
 * the host sent data after the arm, such as the acknowledgement of the probe, the wait extends to
 * 60 s after the arm: the host has the probe and is only slow (#1954).
 * pending: otherwise, until 12 s after the arm. The caller's timeout limits each deadline.
 * `earlier` holds the previous samples of this probe, oldest first.
 */
export function judgePath(arm: ProbeArm, earlier: readonly ProbeSample[], now: ProbeSample): PathVerdict {
  const deadline = arm.at + Math.min(PROBE_DEADLINE_MS, arm.limitMs);
  const left = [...earlier, now].find((sample) => probeLeft(arm, sample));
  if (left) {
    // Data from the host after the arm includes the acknowledgement of the probe: the host has it.
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

/** Without path stats the probe cannot be judged, so it gets the answer window as a plain timeout. */
export function unmeasuredProbeMs(fresh: boolean) {
  return fresh ? FRESH_PEER_ANSWER_MS : MAX_ANSWER_MS;
}

function answerWindowMs(arm: ProbeArm): number {
  if (arm.fresh) return FRESH_PEER_ANSWER_MS;
  if (arm.rttMs === null) return MAX_ANSWER_MS;
  return Math.min(MAX_ANSWER_MS, Math.max(MIN_ANSWER_MS, ANSWER_RTT_FACTOR * arm.rttMs + ANSWER_MARGIN_MS));
}
