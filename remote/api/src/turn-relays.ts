import { createHash } from "node:crypto";
import { Effect, Layer, Schedule } from "effect";
import type { RemoteApiConfig } from "./config";
import { probeTurnAllocation, type TurnProbeError } from "./turn-probe";

const PROBE_CACHE = "1 minute";
const CHECK_INTERVAL = "1 minute";

export class TurnRelays {
  readonly #hosts: readonly string[];
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

  get localProbe(): Effect.Effect<void, TurnProbeError> {
    return this.#probe(this.#hosts[0] ?? "");
  }

  watch(): Layer.Layer<never> {
    const checkAll = Effect.forEach(this.#probes.values(), (probe) => Effect.ignore(probe), {
      concurrency: "unbounded",
      discard: true,
    });
    return Layer.effectDiscard(Effect.forkScoped(checkAll.pipe(Effect.repeat(Schedule.spaced(CHECK_INTERVAL)))));
  }

  states(): Array<{ host: string; available: boolean | null }> {
    return this.#hosts.map((host) => ({ host, available: this.#available.get(host) ?? null }));
  }

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
