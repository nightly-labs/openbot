import { DEFAULT_RESPONSE_STYLE, type HostAdminDesktopApi, type HostPersonality } from "@openbot/contracts/ipc";

/** Preview has one host, so every server shares this personality. */
export function createMockHostPersonality(): Pick<HostAdminDesktopApi, "getPersonality" | "setPersonality"> {
  const personality: HostPersonality = { responseStyle: DEFAULT_RESPONSE_STYLE };
  return {
    getPersonality: async () => ({ ...personality }),
    setPersonality: async (change) => {
      personality.responseStyle = change.responseStyle;
      return { ...personality };
    },
  };
}
