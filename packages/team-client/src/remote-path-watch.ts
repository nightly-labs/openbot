export const PATH_WATCH_INTERVAL_MS = 5_000;
export const PATH_SILENCE_MS = 12_000;
export const RELAY_UPGRADE_DELAYS_MS = [60_000, 180_000, 540_000] as const;

export interface PathReading {
  pairId: string;
  received: number;
  relayed: boolean;
}

export interface PathWatchStep {
  silent: boolean;
  routeChanged: boolean;
  upgradeDue: boolean;
}

const QUIET: PathWatchStep = { silent: false, routeChanged: false, upgradeDue: false };

export function createPathWatch() {
  let heard: { pairId: string; received: number; at: number } | null = null;
  let relayedSince: number | null = null;
  let upgrades = 0;

  function reset(): void {
    heard = null;
    relayedSince = null;
  }

  function heardSilence(reading: PathReading, now: number): Omit<PathWatchStep, "upgradeDue"> {
    const routeChanged = heard !== null && heard.pairId !== reading.pairId;
    if (heard === null || routeChanged || reading.received > heard.received) {
      heard = { pairId: reading.pairId, received: reading.received, at: now };
      return { silent: false, routeChanged };
    }
    if (now - heard.at < PATH_SILENCE_MS) return { silent: false, routeChanged };
    heard = { ...heard, at: now };
    return { silent: true, routeChanged };
  }

  function relayUpgradeDue(reading: PathReading, now: number): boolean {
    if (!reading.relayed) {
      relayedSince = null;
      return false;
    }
    relayedSince ??= now;
    const wait = RELAY_UPGRADE_DELAYS_MS[upgrades];
    return wait !== undefined && now - relayedSince >= wait;
  }

  return {
    observe(reading: PathReading | null, now: number): PathWatchStep {
      if (!reading) {
        reset();
        return QUIET;
      }
      return { ...heardSilence(reading, now), upgradeDue: relayUpgradeDue(reading, now) };
    },
    upgradeStarted(now: number): void {
      upgrades += 1;
      relayedSince = now;
    },
    reset,
  };
}

export type PathWatch = ReturnType<typeof createPathWatch>;
