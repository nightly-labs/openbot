import * as Network from "expo-network";
import { AppState } from "react-native";
import { liveVoiceWebRtc } from "@/features/voice/model/live-voice-webrtc";
import {
  candidateLineAddress,
  type InterfaceAddress,
  interfaceAddresses,
  type PhoneConnection,
  phoneNetworkText,
  probeShape,
} from "./phone-network";
import { supportLog } from "./support-log";

/** Candidates of the phone's own interfaces come in a few milliseconds. No server is asked. */
const GATHER_LIMIT_MS = 1_500;
const NOT_READ = "Not read yet";

let text = NOT_READ;
let reading: Promise<string> | null = null;
/** The network changed while a read ran, so its result can be old. */
let again = false;
let installed = false;
/** The shape of the probe goes to the log one time in each launch. */
let shapeLogged = false;
const listeners = new Set<() => void>();

function connectionOf(state: Network.NetworkState): PhoneConnection {
  if (state.isConnected === false || state.type === Network.NetworkStateType.NONE) return "none";
  if (state.type === Network.NetworkStateType.WIFI) return "wifi";
  if (state.type === Network.NetworkStateType.CELLULAR) return "cellular";
  if (state.type === Network.NetworkStateType.ETHERNET) return "ethernet";
  // Android only. On iOS a VPN shows only as an interface.
  if (state.type === Network.NetworkStateType.VPN) return "vpn";
  return "unknown";
}

/**
 * The addresses of the phone's network interfaces, each with the mark of a VPN interface. The
 * native WebRTC library lists them when a connection gathers its own candidates. This connection
 * has no ICE server and no other side, so it sends nothing. Null in an app build without the
 * library, or when the read fails.
 */
async function readInterfaces(): Promise<InterfaceAddress[] | null> {
  const webRtc = liveVoiceWebRtc;
  if (!webRtc) return null;
  let connection: InstanceType<typeof webRtc.RTCPeerConnection> | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const probe = new webRtc.RTCPeerConnection({ iceServers: [] });
    connection = probe;
    const lines: string[] = [];
    const gathered = new Promise<void>((resolve) => {
      probe.addEventListener("icecandidate", (event) => {
        if (event.candidate) lines.push(event.candidate.candidate);
        else resolve();
      });
      probe.addEventListener("icegatheringstatechange", () => {
        if (probe.iceGatheringState === "complete") resolve();
      });
      timer = setTimeout(resolve, GATHER_LIMIT_MS);
    });
    probe.createDataChannel("network");
    await probe.setLocalDescription(await probe.createOffer({}));
    await gathered;
    const stats = await probe.getStats();
    const reports = stats instanceof Map ? [...stats.values()] : [];
    const found = interfaceAddresses(reports);
    // A library version whose statistics have no local candidates still gives their lines.
    for (const line of lines) {
      const address = candidateLineAddress(line);
      if (address && !found.some((entry) => entry.address === address))
        found.push({ address, vpn: null, underlying: null });
    }
    if (!shapeLogged) {
      shapeLogged = true;
      supportLog.add("info", "app", `Network probe: ${probeShape(reports, lines, found.length)}`);
    }
    return found;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    connection?.close();
  }
}

async function read(): Promise<string> {
  const [state, addresses] = await Promise.all([
    Network.getNetworkStateAsync().catch((): Network.NetworkState => ({})),
    readInterfaces(),
  ]);
  return phoneNetworkText({ connection: connectionOf(state), addresses });
}

/**
 * Reads the network again and gives its text. A change goes to the support log, so a report shows
 * the VPN that was on when the problem came, and not only the one at the time of the report.
 */
export function refreshPhoneNetwork(): Promise<string> {
  if (reading) {
    again = true;
    return reading;
  }
  const current = (async () => {
    let next = text;
    do {
      again = false;
      next = await read().catch(() => text);
    } while (again);
    if (next !== text) {
      text = next;
      supportLog.add("info", "app", `Network: ${next}`);
      for (const listener of listeners) listener();
    }
    return text;
  })().finally(() => {
    reading = null;
  });
  reading = current;
  return current;
}

/** The network and the VPN of the last read, such as `Wi-Fi · VPN: Tailscale`. */
export function phoneNetwork(): string {
  return text;
}

export function subscribePhoneNetwork(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Reads the network at the start, at each change of the network, and at each return to the app. */
export function installPhoneNetwork(): void {
  if (installed) return;
  installed = true;
  Network.addNetworkStateListener(() => void refreshPhoneNetwork());
  AppState.addEventListener("change", (state) => {
    if (state === "active") void refreshPhoneNetwork();
  });
  // After the first screen: the read makes a native connection object.
  requestIdleCallback(() => void refreshPhoneNetwork());
}
