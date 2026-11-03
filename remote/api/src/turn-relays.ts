import { createHash } from "node:crypto";
import { Effect, Layer, Schedule } from "effect";
import type { RemoteApiConfig } from "./config";
import { probeTurnAllocation, type TurnProbeError } from "./turn-probe";

// `/health/turn` and the background check share the probe of each relay, so a relay gets at most one
// probe allocation a minute from this Signal.
const PROBE_CACHE = "1 minute";
const CHECK_INTERVAL = "1 minute";

/**
 * The coturn servers that this Signal gives to peers. They share `TURN_SHARED_SECRET` and the TURN
 * ports, so the credentials of `RemoteTokenService.iceServers` work on each of them.
 *
 * A host and its clients get the same relay: the rendezvous hash of the host ID over the relays whose
 * last probe allocated, or that have no probe yet. So the sessions of a host meet on one relay, a relay
 * that stops allocating moves only its own hosts, and they go back when it allocates again. When no
 * relay allocates, the hash runs over all of them. A peer gets only one relay: a browser allocates on
 * each TURN server it gets, so two relays would use two allocations of the coturn quota for each peer.
 */
export class TurnRelays {
  readonly #hosts: readonly string[];
  // `false` after a failed probe, `true` after an allocation. A relay that has no probe yet is available.
  readonly #available = new Map<string, boolean>();
  readonly #probes: ReadonlyMap<string, Effect.Effect<void, TurnProbeError>>;

  constructor(config: Pick<RemoteApiConfig, "turnHosts" | "turnPort" | "turnSecret">) {
    this.#hosts = config.turnHosts;
    this.#probes = new Map(
      config.turnHosts.map((host) => [
        host,
        Effect.runSync(
          Effect.cachedWithTTL(
            probeTurnAllocation(host, config).pipe(
              Effect.tap(() => Effect.sync(() => this.#available.set(host, true))),
              Effect.tapError(() => Effect.sync(() => this.#available.set(host, false))),
            ),
            PROBE_CACHE,
          ),
        ),
      ]),
    );
  }

  /** The probe of `TURN_HOST`, the relay on the machine of this Signal. */
  get localProbe(): Effect.Effect<void, TurnProbeError> {
    return this.#probe(this.#hosts[0] ?? "");
  }

  /** Probes every relay again each minute while the layer is open. */
  watch(): Layer.Layer<never> {
    const checkAll = Effect.forEach(this.#probes.values(), (probe) => Effect.ignore(probe), {
      concurrency: "unbounded",
      discard: true,
    });
    return Layer.effectDiscard(Effect.forkScoped(checkAll.pipe(Effect.repeat(Schedule.spaced(CHECK_INTERVAL)))));
  }

  /** Each relay with the result of its last probe: `null` before the first probe ends. */
  states(): Array<{ host: string; available: boolean | null }> {
    return this.#hosts.map((host) => ({ host, available: this.#available.get(host) ?? null }));
  }

  /** The relay for the host `hostId` and its clients. */
  pick(hostId: string): string {
    const available = this.#hosts.filter((host) => this.#available.get(host) !== false);
    const candidates = available.length > 0 ? available : this.#hosts;
    let picked = candidates[0] ?? "";
    let highest = -1n;
    for (const host of candidates) {
      const score = createHash("sha256").update(`${host}\n${hostId}`).digest().readBigUInt64BE(0);
      if (score > highest) {
        highest = score;
        picked = host;
      }
    }
    return picked;
  }

  #probe(host: string): Effect.Effect<void, TurnProbeError> {
    return this.#probes.get(host) ?? Effect.void;
  }
}
