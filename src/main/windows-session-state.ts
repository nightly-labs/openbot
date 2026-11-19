import { createRequire } from "node:module";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import type * as Koffi from "koffi";

const logger = createOpenBotLogger("windows-session-state");
const requireModule = createRequire(import.meta.url);

const WTS_CURRENT_SESSION = 0xffff_ffff;
const WTS_CONNECT_STATE = 8;
const WTS_DISCONNECTED = 4;

interface WtsApi {
  querySessionInformation: (
    server: null,
    sessionId: number,
    infoClass: number,
    buffer: [bigint | null],
    bytes: [number],
  ) => number;
  freeMemory: (memory: bigint) => void;
  readInt: (memory: bigint) => number;
}

let wtsApi: WtsApi | null = null;

function loadWtsApi(): WtsApi {
  if (wtsApi) return wtsApi;
  const koffi: typeof Koffi = requireModule("koffi");
  const library = koffi.load("wtsapi32.dll");
  wtsApi = {
    querySessionInformation: library.func(
      "int __stdcall WTSQuerySessionInformationW(void *server, uint32_t sessionId, int infoClass, _Out_ void **buffer, _Out_ uint32_t *bytes)",
    ),
    freeMemory: library.func("void __stdcall WTSFreeMemory(void *memory)"),
    readInt: (memory) => koffi.decode(memory, "int"),
  };
  return wtsApi;
}

export function windowsSessionDisconnected(): boolean {
  if (process.platform !== "win32") return false;
  try {
    const api = loadWtsApi();
    const buffer: [bigint | null] = [null];
    if (!api.querySessionInformation(null, WTS_CURRENT_SESSION, WTS_CONNECT_STATE, buffer, [0]) || !buffer[0]) {
      return false;
    }
    try {
      return api.readInt(buffer[0]) === WTS_DISCONNECTED;
    } finally {
      api.freeMemory(buffer[0]);
    }
  } catch (error) {
    logger.warn("Unable to read the Windows session state:", toLogValue(error));
    return false;
  }
}
