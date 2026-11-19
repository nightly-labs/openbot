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

const GATHER_LIMIT_MS = 1_500;
const NOT_READ = "Not read yet";

let text = NOT_READ;
let reading: Promise<string> | null = null;
let again = false;
let installed = false;
let shapeLogged = false;
const listeners = new Set<() => void>();

function connectionOf(state: Network.NetworkState): PhoneConnection {
  if (state.isConnected === false || state.type === Network.NetworkStateType.NONE) return "none";
  if (state.type === Network.NetworkStateType.WIFI) return "wifi";
  if (state.type === Network.NetworkStateType.CELLULAR) return "cellular";
  if (state.type === Network.NetworkStateType.ETHERNET) return "ethernet";
  if (state.type === Network.NetworkStateType.VPN) return "vpn";
  return "unknown";
}

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

export function phoneNetwork(): string {
  return text;
}

export function subscribePhoneNetwork(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function installPhoneNetwork(): void {
  if (installed) return;
  installed = true;
  Network.addNetworkStateListener(() => void refreshPhoneNetwork());
  AppState.addEventListener("change", (state) => {
    if (state === "active") void refreshPhoneNetwork();
  });
  requestIdleCallback(() => void refreshPhoneNetwork());
}
