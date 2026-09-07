import type { MobileConnectedDevice, MobileConnectTicket } from "@openbot/contracts/ipc";
import { createEffect, createMemo, createSignal, createStore, onCleanup } from "solid-js";

const MOBILE_CONNECT_SUCCESS_FEEDBACK_MS = 900;
const MOBILE_CONNECT_COLLAPSE_MS = 240;
const MOBILE_DEVICES_REFRESH_INTERVAL_MS = 60_000;
const MOBILE_CONNECT_PENDING_REFRESH_INTERVAL_MS = 5_000;

interface MobileConnectStoreProps {
  open: boolean;
  onCreateMobileConnect?: () => Promise<MobileConnectTicket>;
  onListMobileConnectedDevices?: () => Promise<MobileConnectedDevice[]>;
  onRevokeMobileConnectedDevice?: (sessionId: string) => Promise<void>;
}

/** A generated Mobile Connect code, from the moment it is displayed until it is cleared. */
interface MobileConnectSession {
  /** True while the success banner plays its collapse animation. */
  collapsing: boolean;
  /**
   * When this code became able to pair a phone. Null while a replacement code is being generated:
   * the code on screen is still the old one, and a device that appears now is not its doing.
   */
  startedAt: number | null;
  successDeviceName: string | null;
  ticket: MobileConnectTicket;
}

interface MobileConnectPanel {
  busy: boolean;
  error: string | null;
  /** Carries `startedAt`, so neither can exist without the other. */
  session: MobileConnectSession | null;
}

interface MobileDeviceList {
  devices: MobileConnectedDevice[];
  error: string | null;
  /** Stays true across a refresh, so the list keeps rendering while `loading` is also true. */
  loaded: boolean;
  loading: boolean;
  revokingSessionId: string | null;
}

interface SettingsMobileConnectPanels {
  connect: MobileConnectPanel;
  devices: MobileDeviceList;
}

/**
 * The Mobile Connect tab: the one-time code, the connected device list, and every timer either
 * needs — the countdown clock, the device poll and the success-banner collapse.
 */
export function createSettingsMobileConnectStore(props: MobileConnectStoreProps, isActive: () => boolean) {
  const [panels, setPanels] = createStore<SettingsMobileConnectPanels>({
    connect: { busy: false, error: null, session: null },
    devices: { devices: [], error: null, loaded: false, loading: false, revokingSessionId: null },
  });
  /** A clock, not panel state: it ticks the code's countdown and the device list's "3m ago" labels. */
  const [now, setNow] = createSignal(Date.now());
  let devicesRequestRevision = 0;
  let baselineSessionIds = new Set<string>();
  let successTimer: number | undefined;
  let cleanupTimer: number | undefined;

  createEffect(
    () => ({
      open: props.open,
      active: isActive(),
      list: props.onListMobileConnectedDevices,
      ticketExpiresAt: panels.connect.session?.ticket.expiresAt ?? null,
    }),
    ({ open, active, list }) => {
      devicesRequestRevision += 1;
      if (!open || !active || !list) return;
      let running = true;
      let timer: number | undefined;

      const scheduleRefresh = () => {
        const ticket = panels.connect.session?.ticket;
        const refreshInterval =
          ticket && ticket.expiresAt > Date.now()
            ? MOBILE_CONNECT_PENDING_REFRESH_INTERVAL_MS
            : MOBILE_DEVICES_REFRESH_INTERVAL_MS;
        timer = window.setTimeout(async () => {
          await refreshDevices(false);
          if (running) scheduleRefresh();
        }, refreshInterval);
      };

      void refreshDevices(true);
      scheduleRefresh();
      return () => {
        running = false;
        devicesRequestRevision += 1;
        if (timer !== undefined) window.clearTimeout(timer);
      };
    },
  );

  const secondsRemaining = createMemo(() =>
    Math.max(0, Math.ceil(((panels.connect.session?.ticket.expiresAt ?? 0) - now()) / 1_000)),
  );
  const expired = () => Boolean(panels.connect.session && secondsRemaining() === 0);
  const expiryLabel = () => {
    const seconds = secondsRemaining();
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
  };

  createEffect(
    () => ({ open: props.open, ticket: panels.connect.session?.ticket ?? null }),
    ({ open, ticket }) => {
      if (!open || !ticket) return;
      setNow(Date.now());
      const timer = window.setInterval(() => setNow(Date.now()), 1_000);
      return () => window.clearInterval(timer);
    },
  );

  async function createTicket(): Promise<void> {
    if (panels.connect.busy || !props.onCreateMobileConnect) return;
    clearFeedbackTimers();
    setPanels((state) => {
      state.connect.busy = true;
      state.connect.error = null;
      // The old code stays on screen while the new one is generated, but stops being able to pair.
      if (state.connect.session) {
        state.connect.session.collapsing = false;
        state.connect.session.startedAt = null;
        state.connect.session.successDeviceName = null;
      }
    });
    try {
      let baselineDevices = panels.devices.devices;
      if (props.onListMobileConnectedDevices) {
        const refreshedDevices = await refreshDevices(true);
        if (!refreshedDevices) {
          throw new Error(panels.devices.error ?? "Could not load connected devices before generating a code.");
        }
        baselineDevices = refreshedDevices;
      }
      baselineSessionIds = new Set(baselineDevices.map((device) => device.sessionId));
      const ticket = await props.onCreateMobileConnect();
      const issuedAt = Date.now();
      setPanels((state) => {
        state.connect.session = { collapsing: false, startedAt: issuedAt, successDeviceName: null, ticket };
      });
      setNow(issuedAt);
    } catch (error) {
      setPanels((state) => {
        state.connect.session = null;
        state.connect.error = error instanceof Error ? error.message : "Could not generate a Mobile Connect code.";
      });
    } finally {
      setPanels((state) => {
        state.connect.busy = false;
      });
    }
  }

  async function refreshDevices(showLoading: boolean): Promise<MobileConnectedDevice[] | null> {
    const list = props.onListMobileConnectedDevices;
    if (!list || panels.devices.revokingSessionId) return null;
    const revision = ++devicesRequestRevision;
    if (showLoading)
      setPanels((state) => {
        state.devices.loading = true;
      });
    try {
      const devices = await list();
      if (revision !== devicesRequestRevision) return null;
      const connectedDevice = newlyConnectedDevice(devices);
      setPanels((state) => {
        state.devices.devices = devices;
        state.devices.loaded = true;
        state.devices.error = null;
      });
      setNow(Date.now());
      if (connectedDevice) showSuccess(connectedDevice);
      return devices;
    } catch (error) {
      if (revision !== devicesRequestRevision) return null;
      setPanels((state) => {
        state.devices.error = error instanceof Error ? error.message : "Could not load connected devices.";
      });
      return null;
    } finally {
      if (revision === devicesRequestRevision)
        setPanels((state) => {
          state.devices.loading = false;
        });
    }
  }

  function newlyConnectedDevice(devices: MobileConnectedDevice[]): MobileConnectedDevice | null {
    const session = panels.connect.session;
    const startedAt = session?.startedAt;
    if (
      !session ||
      startedAt === null ||
      startedAt === undefined ||
      session.successDeviceName ||
      Date.now() > session.ticket.expiresAt + 5_000
    ) {
      return null;
    }
    return (
      devices.find(
        (device) =>
          !baselineSessionIds.has(device.sessionId) &&
          (panels.devices.loaded || device.connectedAt >= startedAt - 5_000),
      ) ?? null
    );
  }

  function showSuccess(device: MobileConnectedDevice): void {
    clearFeedbackTimers();
    setPanels((state) => {
      if (state.connect.session) state.connect.session.successDeviceName = device.name;
    });
    successTimer = window.setTimeout(() => {
      setPanels((state) => {
        if (state.connect.session) state.connect.session.collapsing = true;
      });
      cleanupTimer = window.setTimeout(() => {
        setPanels((state) => {
          state.connect.session = null;
        });
      }, MOBILE_CONNECT_COLLAPSE_MS);
    }, MOBILE_CONNECT_SUCCESS_FEEDBACK_MS);
  }

  function clearFeedbackTimers(): void {
    if (successTimer !== undefined) window.clearTimeout(successTimer);
    if (cleanupTimer !== undefined) window.clearTimeout(cleanupTimer);
    successTimer = undefined;
    cleanupTimer = undefined;
  }

  onCleanup(clearFeedbackTimers);

  async function revokeDevice(device: MobileConnectedDevice): Promise<void> {
    if (!props.onRevokeMobileConnectedDevice || panels.devices.revokingSessionId) return;
    devicesRequestRevision += 1;
    setPanels((state) => {
      state.devices.loading = false;
      state.devices.revokingSessionId = device.sessionId;
      state.devices.error = null;
    });
    try {
      await props.onRevokeMobileConnectedDevice(device.sessionId);
      setPanels((state) => {
        state.devices.devices = state.devices.devices.filter((candidate) => candidate.sessionId !== device.sessionId);
      });
    } catch (error) {
      setPanels((state) => {
        state.devices.error = error instanceof Error ? error.message : "Could not disconnect this device.";
      });
    } finally {
      setPanels((state) => {
        state.devices.revokingSessionId = null;
      });
    }
  }

  function deviceTimeLabel(timestamp: number): string {
    const elapsedSeconds = Math.max(0, Math.floor((now() - timestamp) / 1_000));
    if (elapsedSeconds < 60) return "Just now";
    const elapsedMinutes = Math.floor(elapsedSeconds / 60);
    if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;
    const elapsedHours = Math.floor(elapsedMinutes / 60);
    if (elapsedHours < 24) return `${elapsedHours}h ago`;
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(timestamp);
  }

  return { createTicket, deviceTimeLabel, expired, expiryLabel, revokeDevice, secondsRemaining, state: panels };
}

export type SettingsMobileConnectStore = ReturnType<typeof createSettingsMobileConnectStore>;
