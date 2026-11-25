import type { HostAdminDesktopApi, HostSignalHomeSettings } from "@openbot/contracts/ipc";

export function createMockHostSignalHome(): Pick<HostAdminDesktopApi, "getSignalHome" | "setSignalHome"> {
  const settings: HostSignalHomeSettings = {
    preferred: null,
    current: "a",
    homes: [
      { id: "a", latencyMs: 24 },
      { id: "b", latencyMs: 26 },
      { id: "us", latencyMs: 158 },
      { id: "au", latencyMs: 291 },
      { id: "sg", latencyMs: null },
    ],
  };
  const snapshot = (): HostSignalHomeSettings => ({ ...settings, homes: settings.homes.map((home) => ({ ...home })) });
  return {
    getSignalHome: async () => snapshot(),
    setSignalHome: async (home) => {
      settings.preferred = home;
      settings.current = home ?? "a";
      return snapshot();
    },
  };
}
