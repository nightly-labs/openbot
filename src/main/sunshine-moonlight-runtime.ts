import { type ChildProcess, spawn as nodeSpawn, type SpawnOptions } from "node:child_process";
import { createHash, randomBytes, timingSafeEqual, X509Certificate } from "node:crypto";
import { createSocket } from "node:dgram";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, request as httpRequest, type IncomingMessage, type Server } from "node:http";
import https from "node:https";
import { createServer as createTcpServer } from "node:net";
import { dirname, join } from "node:path";
import type { PeerCertificate } from "node:tls";
import type {
  RemoteDesktopDisplay,
  RemoteDesktopIceServer,
  RemoteDesktopSetupStatus,
  RemoteDesktopTestStatus,
} from "@openbot/contracts/ipc";
import { z } from "zod";
import type { RemoteDesktopRuntimePaths } from "./remote-desktop-runtime-artifact";
import { forwardDiagnosticLines, stopRemoteProcess } from "./remote-diagnostics";

export class SunshineApiError extends Error {
  constructor(readonly status: number) {
    super(`Sunshine API failed with HTTP ${status}.`);
    this.name = "SunshineApiError";
  }
}

const MOONLIGHT_STREAMER_SLOTS = 4;
// First candidate for Sunshine's base port. Sunshine derives its whole port family from this one
// `port` value, so every OpenBot instance must claim a disjoint family: two macOS users share one
// network namespace, and a second Sunshine bound to the same ports fails to start.
export const SUNSHINE_DEFAULT_BASE_PORT = 47_989;
// Offsets Sunshine applies to the base port (GameStream HTTPS, HTTP, Web UI HTTPS, video, control,
// audio, RTSP setup). The family spans base - 5 through base + 21; allocations stay clear of each
// other by that whole span, not just the two API ports.
const SUNSHINE_PORT_FAMILY_OFFSETS = [-5, 0, 1, 9, 10, 11, 21];
const SUNSHINE_PORT_FAMILY_MIN_OFFSET = -5;
const SUNSHINE_PORT_FAMILY_MAX_OFFSET = 21;
const SUNSHINE_PORT_FAMILY_SPAN = SUNSHINE_PORT_FAMILY_MAX_OFFSET - SUNSHINE_PORT_FAMILY_MIN_OFFSET + 1;
const SUNSHINE_BASE_PORT_STEP = SUNSHINE_PORT_FAMILY_SPAN + 5;
const SUNSHINE_BASE_PORT_CEILING = 65_535 - SUNSHINE_PORT_FAMILY_MAX_OFFSET;
const SUNSHINE_ALLOCATION_ATTEMPTS = 64;
const READINESS_ATTEMPT_TIMEOUT_MS = 5_000;
const SUNSHINE_START_ATTEMPTS = 3;
const MOONLIGHT_WEBRTC_RANGE_SIZE = 32;
const MOONLIGHT_WEBRTC_RANGE_START = 40_000;
// Sunshine keeps running when the operating system refuses it screen capture: it prints this, fails
// to find a display or an encoder, and then serves its API normally. Nothing else distinguishes a
// host that will never produce a frame from one that is about to, so watching its own output is what
// turns a member's session hanging at "connecting" into an error naming what the host owner must do.
const SUNSHINE_SCREEN_CAPTURE_DENIED = "No screen capture permission";
// Enough of what a stream has already printed to keep the marker findable when reads split it.
const SUNSHINE_DIAGNOSTIC_OVERLAP = SUNSHINE_SCREEN_CAPTURE_DENIED.length;

// One watcher per stream, because a chunk boundary falls wherever the pipe happened to fill and the
// marker is longer than some of Sunshine's lines. Carrying the accumulated end forward -- rather
// than the last chunk -- is what survives a marker spread over three reads.
export function createScreenCaptureDenialWatcher(): (message: string) => boolean {
  let printed = "";
  return (message) => {
    printed = `${printed}${message}`;
    const denied = printed.includes(SUNSHINE_SCREEN_CAPTURE_DENIED);
    printed = printed.slice(-SUNSHINE_DIAGNOSTIC_OVERLAP);
    return denied;
  };
}

export function sunshineHttpPortForBase(basePort: number): number {
  return basePort;
}

export function sunshineHttpsPortForBase(basePort: number): number {
  return basePort + 1;
}

function sunshinePortFamilyForBase(basePort: number): { min: number; max: number } {
  return {
    min: basePort + SUNSHINE_PORT_FAMILY_MIN_OFFSET,
    max: basePort + SUNSHINE_PORT_FAMILY_MAX_OFFSET,
  };
}

export function sunshinePortFamiliesOverlap(first: number, second: number): boolean {
  const a = sunshinePortFamilyForBase(first);
  const b = sunshinePortFamilyForBase(second);
  return a.min <= b.max && b.min <= a.max;
}

export interface MoonlightWebRtcPortRange {
  min: number;
  max: number;
}

// Base ports claimed by live runtimes in this process. Two runtimes started together would both
// probe the same free ports before either Sunshine binds, so the registry is what keeps their
// allocations apart; the bind probes below are what keeps them apart from other processes and
// other macOS users.
const claimedSunshineBasePorts = new Set<number>();
// Hold one TCP listener at the first port of each fixed UDP range for its whole lifetime.
// The kernel makes this reservation exclusive across processes and macOS users. Media uses UDP.
const webRtcReservations = new Map<number, ReturnType<typeof createTcpServer>>();

/** Reserve a Sunshine base port whose whole port family is free on loopback. */
export async function allocateSunshineBasePort(): Promise<number> {
  let candidate = SUNSHINE_DEFAULT_BASE_PORT;
  for (
    let attempt = 0;
    attempt < SUNSHINE_ALLOCATION_ATTEMPTS && candidate <= SUNSHINE_BASE_PORT_CEILING;
    attempt += 1
  ) {
    if (![...claimedSunshineBasePorts].some((active) => sunshinePortFamiliesOverlap(candidate, active))) {
      claimedSunshineBasePorts.add(candidate);
      try {
        if (await sunshinePortFamilyFree(candidate)) return candidate;
      } catch {
        // Treat probe failures as "not free" and keep scanning; the bind error itself is
        // re-surfaced if no candidate works.
      }
      claimedSunshineBasePorts.delete(candidate);
    }
    candidate += SUNSHINE_BASE_PORT_STEP;
  }
  throw new Error("Could not reserve a free Sunshine port family for Remote Desktop.");
}

export function releaseSunshineBasePort(basePort: number): void {
  claimedSunshineBasePorts.delete(basePort);
}

/** Reserve a block of consecutive UDP ports for one Moonlight WebRTC streamer. */
export async function allocateWebRtcPortRange(): Promise<MoonlightWebRtcPortRange> {
  const size = MOONLIGHT_WEBRTC_RANGE_SIZE;
  for (let min = MOONLIGHT_WEBRTC_RANGE_START; min + size - 1 <= 65_535; min += size) {
    const max = min + size - 1;
    const range = { min, max };
    let reservation: ReturnType<typeof createTcpServer> | null = null;
    try {
      reservation = await listenTcp(min);
      reservation.on("connection", (socket) => socket.destroy());
      if (await udpRangeFree(range)) {
        webRtcReservations.set(min, reservation);
        return range;
      }
    } catch {
      // Probe failures mean "not free" here as well.
    }
    if (reservation) await new Promise<void>((resolve) => reservation?.close(() => resolve()));
  }
  throw new Error("Could not reserve a free Moonlight WebRTC port range for Remote Desktop.");
}

export function releaseWebRtcPortRange(range: MoonlightWebRtcPortRange): void {
  webRtcReservations.get(range.min)?.close();
  webRtcReservations.delete(range.min);
}

async function sunshinePortFamilyFree(basePort: number): Promise<boolean> {
  const sockets: Array<{ close: (callback: () => void) => void }> = [];
  try {
    for (const offset of SUNSHINE_PORT_FAMILY_OFFSETS) {
      sockets.push(await listenTcp(basePort + offset));
      sockets.push(await bindUdp(basePort + offset));
    }
    return true;
  } catch {
    return false;
  } finally {
    await Promise.all(sockets.map((socket) => new Promise<void>((resolve) => socket.close(() => resolve()))));
  }
}

async function udpRangeFree(range: MoonlightWebRtcPortRange): Promise<boolean> {
  const sockets: Array<{ close: (callback: () => void) => void }> = [];
  try {
    for (let port = range.min; port <= range.max; port += 1) sockets.push(await bindUdp(port));
    return true;
  } catch {
    return false;
  } finally {
    await Promise.all(sockets.map((socket) => new Promise<void>((resolve) => socket.close(() => resolve()))));
  }
}

function listenTcp(port: number): Promise<ReturnType<typeof createTcpServer>> {
  return new Promise((resolve, reject) => {
    const server = createTcpServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve(server);
    });
  });
}

function bindUdp(port: number): Promise<ReturnType<typeof createSocket>> {
  return new Promise((resolve, reject) => {
    const socket = createSocket("udp4");
    const onError = (error: Error): void => {
      socket.close(() => reject(error));
    };
    socket.once("error", onError);
    socket.bind(port, "127.0.0.1", () => {
      socket.removeListener("error", onError);
      resolve(socket);
    });
  });
}
const localAddressSchema = z.object({ address: z.string(), family: z.string(), port: z.number().int() });
const moonlightHostSchema = z.object({
  host_id: z.number().int(),
  paired: z.enum(["Paired", "NotPaired"]),
});
const moonlightHostsSchema = z.object({ hosts: z.array(moonlightHostSchema) });
const moonlightCreatedHostSchema = z.object({ host: moonlightHostSchema });
const moonlightAppsSchema = z.object({
  apps: z.array(z.object({ app_id: z.number().int(), title: z.string() })),
});
const moonlightRoleSchema = z.object({
  role: z.object({
    permissions: z.object({
      allow_transport_webrtc: z.boolean(),
      allow_transport_websockets: z.boolean(),
    }),
  }),
});
const moonlightPairMessageSchema = z.union([
  z.object({ Pin: z.string().min(1) }).transform(({ Pin }) => ({ kind: "pin" as const, pin: Pin })),
  z.object({ Paired: z.object({ host_id: z.number().int() }) }).transform(() => ({ kind: "paired" as const })),
  z.literal("PairError").transform(() => ({ kind: "error" as const })),
  z.literal("InternalServerError").transform(() => ({ kind: "error" as const })),
]);
const sunshineSetupSchema = z.object({
  hostName: z.string().max(255),
  username: z.string().max(255),
  screenRecording: z.enum(["allowed", "blocked"]),
  accessibility: z.enum(["allowed", "blocked"]),
  guiSession: z.enum(["allowed", "blocked"]),
  displays: z.enum(["allowed", "unavailable", "failed"]),
  restartRequired: z.boolean(),
});
const sunshineTestSchema = z.object({
  active: z.boolean(),
  mouse: z.boolean(),
  keyboard: z.boolean(),
  code: z.string().regex(/^(?:[0-9]{4})?$/u),
});

const sunshineDisplaysSchema = z.object({
  displays: z.array(z.object({ id: z.string().min(1), name: z.string().min(1) })),
});

interface MoonlightRequestInit {
  method?: "GET" | "POST" | "DELETE";
  body?: string;
}

export interface SunshineMoonlightRuntimeState {
  /** Private local credential; never send it to clients or diagnostics. */
  authHeader: string;
  baseUrl: string;
  hostId: number;
  hostIds: number[];
  desktopAppId: number;
  displays: RemoteDesktopDisplay[];
  selectedDisplayId: string | null;
}

export type RemoteRuntimeSpawn = (executable: string, args: string[], options: SpawnOptions) => ChildProcess;

interface SunshineMoonlightRuntimeOptions {
  paths: RemoteDesktopRuntimePaths;
  stateDirectory: string;
  platform: "darwin" | "win32";
  credentials: { username: string; password: string };
  getDisplays: () => RemoteDesktopDisplay[];
  getIceServers: () => Promise<RemoteDesktopIceServer[]>;
  spawnProcess?: RemoteRuntimeSpawn;
  onDiagnostic?: (source: "sunshine" | "moonlight", message: string) => void;
  allocateSunshineBasePort?: () => Promise<number>;
  allocateMoonlightPort?: () => Promise<number>;
  allocateWebRtcPortRange?: () => Promise<MoonlightWebRtcPortRange>;
}

export class SunshineMoonlightRuntime {
  readonly #options: SunshineMoonlightRuntimeOptions;
  readonly #spawn: RemoteRuntimeSpawn;
  #sunshine: ChildProcess | null = null;
  #moonlight: ChildProcess | null = null;
  #iceServer: Server | null = null;
  #iceToken = "";
  readonly #pairingName = `openbot-remote-${randomBytes(16).toString("hex")}`;
  #state: SunshineMoonlightRuntimeState | null = null;
  #screenCaptureDenied = false;
  readonly #moonlightHeader = `X-OpenBot-Remote-${randomBytes(32).toString("hex")}`;
  #selectedDisplayId: string | null = null;
  #starting: Promise<SunshineMoonlightRuntimeState> | null = null;
  #sunshineBasePort: number | null = null;
  #ownsSunshineAllocation = false;
  #moonlightPort: number | null = null;
  #webRtcRange: MoonlightWebRtcPortRange | null = null;
  #ownsWebRtcRange = false;

  constructor(options: SunshineMoonlightRuntimeOptions) {
    this.#options = options;
    this.#spawn = options.spawnProcess ?? nodeSpawn;
  }

  get sunshineBasePort(): number | null {
    return this.#sunshineBasePort;
  }

  get sunshineHttpPort(): number | null {
    return this.#sunshineBasePort === null ? null : sunshineHttpPortForBase(this.#sunshineBasePort);
  }

  get sunshineHttpsPort(): number | null {
    return this.#sunshineBasePort === null ? null : sunshineHttpsPortForBase(this.#sunshineBasePort);
  }

  get moonlightPort(): number | null {
    return this.#moonlightPort;
  }

  get webRtcPortRange(): MoonlightWebRtcPortRange | null {
    return this.#webRtcRange ? { ...this.#webRtcRange } : null;
  }

  get state(): SunshineMoonlightRuntimeState | null {
    return this.#state ? { ...this.#state } : null;
  }

  /** Whether Sunshine has said, since it was last started, that it may not record this screen. */
  screenCaptureDenied(): boolean {
    return this.#screenCaptureDenied;
  }

  async start(): Promise<SunshineMoonlightRuntimeState> {
    if (this.#state) return { ...this.#state };
    if (this.#starting) return this.#starting;
    this.#starting = this.#start();
    try {
      return await this.#starting;
    } finally {
      this.#starting = null;
    }
  }

  async checkSetup(): Promise<
    Pick<
      RemoteDesktopSetupStatus,
      "hostName" | "username" | "screenRecording" | "accessibility" | "guiSession" | "displays" | "restartRequired"
    >
  > {
    return sunshineJson(
      this.#requireSunshineHttpsPort(),
      "/api/openbot/setup",
      this.#options.credentials,
      join(this.#options.stateDirectory, "sunshine-cert.pem"),
      sunshineSetupSchema,
    );
  }

  async test(action: "start" | "status" | "stop"): Promise<RemoteDesktopTestStatus> {
    const port = this.#requireSunshineHttpsPort();
    const certificate = join(this.#options.stateDirectory, "sunshine-cert.pem");
    if (action !== "status")
      await sunshineRequest(
        port,
        "/api/openbot/test",
        this.#options.credentials,
        certificate,
        JSON.stringify({ action, displayId: this.#selectedDisplayId ?? "" }),
      );
    return sunshineJson(port, "/api/openbot/test", this.#options.credentials, certificate, sunshineTestSchema);
  }

  async selectDisplay(displayId: string): Promise<void> {
    this.#selectedDisplayId = displayId;
    if (!this.#state) return;
    await this.#writeSunshineConfig();
    if (this.#sunshine) await stopRemoteProcess(this.#sunshine);
    this.#sunshine = null;
    // Reuse the already allocated ports: Moonlight paired against this Sunshine HTTP port, so a
    // reallocation here would orphan every existing pairing.
    await this.#startSunshineOnce();
    if (this.#state) this.#state = { ...this.#state, selectedDisplayId: displayId };
  }

  async stop(): Promise<void> {
    this.#state = null;
    await Promise.all([
      this.#moonlight ? stopRemoteProcess(this.#moonlight) : Promise.resolve(),
      this.#sunshine ? stopRemoteProcess(this.#sunshine) : Promise.resolve(),
    ]);
    this.#moonlight = null;
    this.#sunshine = null;
    const iceServer = this.#iceServer;
    this.#iceServer = null;
    if (iceServer) await new Promise<void>((resolve) => iceServer.close(() => resolve()));
    this.#iceToken = "";
    this.#releasePortClaims();
  }

  #releasePortClaims(): void {
    if (this.#ownsSunshineAllocation && this.#sunshineBasePort !== null) {
      releaseSunshineBasePort(this.#sunshineBasePort);
    }
    if (this.#ownsWebRtcRange && this.#webRtcRange !== null) releaseWebRtcPortRange(this.#webRtcRange);
    this.#sunshineBasePort = null;
    this.#ownsSunshineAllocation = false;
    this.#moonlightPort = null;
    this.#webRtcRange = null;
    this.#ownsWebRtcRange = false;
  }

  #requireSunshineHttpPort(): number {
    const port = this.sunshineHttpPort;
    if (port === null) throw new Error("Sunshine ports have not been allocated yet.");
    return port;
  }

  #requireSunshineHttpsPort(): number {
    const port = this.sunshineHttpsPort;
    if (port === null) throw new Error("Sunshine ports have not been allocated yet.");
    return port;
  }

  async #start(): Promise<SunshineMoonlightRuntimeState> {
    await mkdir(this.#options.stateDirectory, { recursive: true, mode: 0o700 });
    try {
      if (this.#sunshineBasePort === null) {
        if (this.#options.allocateSunshineBasePort) {
          this.#sunshineBasePort = await this.#options.allocateSunshineBasePort();
        } else {
          this.#sunshineBasePort = await allocateSunshineBasePort();
          this.#ownsSunshineAllocation = true;
        }
      }
      await this.#writeSunshineConfig();
      const iceEndpoint = await this.#startIceServer();
      if (this.#moonlightPort === null) {
        this.#moonlightPort = await (this.#options.allocateMoonlightPort ?? reservePort)();
      }
      if (this.#webRtcRange === null) {
        if (this.#options.allocateWebRtcPortRange) {
          this.#webRtcRange = await this.#options.allocateWebRtcPortRange();
        } else {
          this.#webRtcRange = await allocateWebRtcPortRange();
          this.#ownsWebRtcRange = true;
        }
      }
      await this.#writeIceHelper();
      await this.#setSunshineCredentials();
      await this.#startSunshineWithRetry();
      await this.#writeMoonlightConfig();
      const displays = await this.#getSunshineDisplays();
      if (!this.#selectedDisplayId || !displays.some((display) => display.id === this.#selectedDisplayId)) {
        this.#selectedDisplayId = displays.find((display) => display.primary)?.id ?? displays[0]?.id ?? null;
      }
      const moonlightPort = this.#moonlightPort;
      if (moonlightPort === null) throw new Error("Moonlight port has not been allocated yet.");
      this.#startMoonlight(moonlightPort, iceEndpoint);
      await waitForHttp(
        `http://127.0.0.1:${moonlightPort}/api/authenticate`,
        {
          headers: { [this.#moonlightHeader]: moonlightSlotUser(1) },
        },
        this.#moonlight,
      );
      this.#options.onDiagnostic?.("moonlight", "OpenBot: Moonlight Web is ready.\n");
      const paired = await this.#bootstrapMoonlight(moonlightPort);
      this.#state = {
        baseUrl: `http://127.0.0.1:${moonlightPort}`,
        authHeader: this.#moonlightHeader,
        ...paired,
        displays,
        selectedDisplayId: this.#selectedDisplayId,
      };
      return { ...this.#state };
    } catch (error) {
      await this.#stopChildren();
      this.#releasePortClaims();
      throw error;
    }
  }

  async #stopChildren(): Promise<void> {
    await Promise.all([
      this.#moonlight ? stopRemoteProcess(this.#moonlight) : Promise.resolve(),
      this.#sunshine ? stopRemoteProcess(this.#sunshine) : Promise.resolve(),
    ]);
    this.#moonlight = null;
    this.#sunshine = null;
  }

  async #writeSunshineConfig(): Promise<void> {
    const basePort = this.#sunshineBasePort;
    if (basePort === null) throw new Error("Sunshine ports have not been allocated yet.");
    const values = [
      "sunshine_name = OpenBot Remote Desktop",
      // The base port: every other Sunshine port (GameStream HTTP/HTTPS, Web UI HTTPS, video,
      // audio, control, RTSP setup) is offset from this one, so a per-instance base keeps the
      // whole family disjoint from other OpenBot instances on this machine.
      `port = ${basePort}`,
      "upnp = disabled",
      "stream_audio = disabled",
      "origin_web_ui_allowed = pc",
      "address_family = ipv4",
      "bind_address = 127.0.0.1",
      `credentials_file = ${join(this.#options.stateDirectory, "sunshine-credentials.json")}`,
      `file_state = ${join(this.#options.stateDirectory, "sunshine-state.json")}`,
      `file_apps = ${join(this.#options.stateDirectory, "sunshine-apps.json")}`,
      `pkey = ${join(this.#options.stateDirectory, "sunshine-key.pem")}`,
      `cert = ${join(this.#options.stateDirectory, "sunshine-cert.pem")}`,
      `log_path = ${join(this.#options.stateDirectory, "sunshine.log")}`,
      ...(this.#selectedDisplayId ? [`output_name = ${this.#selectedDisplayId}`] : []),
    ];
    await Promise.all([
      writeFile(join(this.#options.stateDirectory, "sunshine.conf"), `${values.join("\n")}\n`, { mode: 0o600 }),
      writeFile(
        join(this.#options.stateDirectory, "sunshine-apps.json"),
        `${JSON.stringify({ env: {}, apps: [{ name: "Desktop", image_path: "desktop.png" }] }, null, 2)}\n`,
        { mode: 0o600 },
      ),
    ]);
  }

  async #writeMoonlightConfig(): Promise<void> {
    const moonlightPort = this.#moonlightPort;
    const webRtcRange = this.#webRtcRange;
    if (moonlightPort === null || webRtcRange === null) {
      throw new Error("Moonlight ports have not been allocated yet.");
    }
    const config = {
      data_storage: {
        type: "json",
        path: join(this.#options.stateDirectory, "moonlight-data.json"),
        session_expiration_check_interval: { secs: 300, nanos: 0 },
      },
      webrtc: {
        ice_servers: [],
        ice_server_script: join(
          this.#options.stateDirectory,
          this.#options.platform === "win32" ? "openbot-ice-helper.cmd" : "openbot-ice-helper.sh",
        ),
        port_range: { min: webRtcRange.min, max: webRtcRange.max },
        nat_1to1: null,
        network_types: ["udp4", "udp6", "tcp4", "tcp6"],
        include_loopback_candidates: false,
      },
      web_server: {
        bind_address: `127.0.0.1:${moonlightPort}`,
        certificate: null,
        url_path_prefix: "",
        session_cookie_secure: false,
        forwarded_header: { username_header: this.#moonlightHeader, auto_create_missing_user: true },
        first_login_create_admin: false,
        first_login_assign_global_hosts: true,
        default_user_id: null,
        default_role_id: null,
        session_cookie_expiration: { secs: 3600, nanos: 0 },
      },
      moonlight: { default_http_port: this.#requireSunshineHttpPort(), pair_device_name: this.#pairingName },
      streamer_path: this.#options.paths.moonlightStreamer,
      log: { level_filter: "Info", file_path: join(this.#options.stateDirectory, "moonlight.log"), dev_venator: false },
      default_settings: null,
    };
    await writeFile(
      join(this.#options.stateDirectory, "moonlight-config.json"),
      `${JSON.stringify(config, null, 2)}\n`,
      {
        mode: 0o600,
      },
    );
  }

  async #writeIceHelper(): Promise<void> {
    const path = join(
      this.#options.stateDirectory,
      this.#options.platform === "win32" ? "openbot-ice-helper.cmd" : "openbot-ice-helper.sh",
    );
    const contents =
      this.#options.platform === "win32"
        ? "@powershell.exe -NoProfile -NonInteractive -Command \"Invoke-RestMethod -Headers @{Authorization=('Bearer ' + $env:OPENBOT_ICE_HELPER_TOKEN)} -Uri $env:OPENBOT_ICE_HELPER_URL | ConvertTo-Json -Compress\"\r\n"
        : `#!/bin/sh\nprintf 'header = "Authorization: Bearer %s"\\nurl = "%s"\\n' "$OPENBOT_ICE_HELPER_TOKEN" "$OPENBOT_ICE_HELPER_URL" | /usr/bin/curl --fail --silent --show-error --config -\n`;
    await writeFile(path, contents, { mode: 0o700 });
    if (this.#options.platform !== "win32") await chmod(path, 0o700);
  }

  async #setSunshineCredentials(): Promise<void> {
    // Matches pinned Sunshine http::save_user_creds and util::Hex (reversed SHA-256,
    // uppercase). Do not pass the plaintext password through globally visible argv.
    const salt = randomBytes(16).toString("hex");
    const password = sunshinePasswordHash(this.#options.credentials.password, salt);
    const path = join(this.#options.stateDirectory, "sunshine-credentials.json");
    await writeFile(path, JSON.stringify({ username: this.#options.credentials.username, salt, password }), {
      mode: 0o600,
    });
    if (this.#options.platform !== "win32") await chmod(path, 0o600);
  }

  // Probing a free family and starting Sunshine cannot be atomic, so a rival process can take
  // the ports in between. On failure the claim is released and the next disjoint family is tried;
  // Moonlight only starts after this succeeds, so reallocating here never orphans a pairing.
  async #startSunshineWithRetry(): Promise<void> {
    let lastError: unknown;
    for (let attempt = 0; attempt < SUNSHINE_START_ATTEMPTS; attempt += 1) {
      try {
        await this.#startSunshineOnce();
        return;
      } catch (error) {
        lastError = error;
        if (this.#sunshine) {
          await stopRemoteProcess(this.#sunshine).catch(() => undefined);
          this.#sunshine = null;
        }
        if (attempt + 1 >= SUNSHINE_START_ATTEMPTS) break;
        if (this.#ownsSunshineAllocation && this.#sunshineBasePort !== null) {
          releaseSunshineBasePort(this.#sunshineBasePort);
          this.#sunshineBasePort = await allocateSunshineBasePort();
        }
        await this.#writeSunshineConfig();
      }
    }
    throw new Error("Sunshine did not start on a reserved port family.", { cause: lastError });
  }

  async #startSunshineOnce(): Promise<void> {
    // A restart is how a newly granted permission takes effect, so the verdict is this process's
    // alone -- carrying the previous one over would keep reporting a grant the user has already made.
    this.#screenCaptureDenied = false;
    this.#sunshine = this.#spawn(this.#options.paths.sunshine, [join(this.#options.stateDirectory, "sunshine.conf")], {
      cwd: dirname(this.#options.paths.sunshine),
      env: { ...process.env, OPENBOT_REMOTE_SETUP: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    this.#pipeDiagnostics(this.#sunshine, "sunshine");
    await waitForHttps(
      this.#requireSunshineHttpsPort(),
      join(this.#options.stateDirectory, "sunshine-cert.pem"),
      this.#sunshine,
    );
  }

  #startMoonlight(port: number, iceEndpoint: string): void {
    this.#moonlight = this.#spawn(
      this.#options.paths.moonlightWebServer,
      [
        "--config-path",
        join(this.#options.stateDirectory, "moonlight-config.json"),
        "--bind-address",
        `127.0.0.1:${port}`,
        "--streamer-path",
        this.#options.paths.moonlightStreamer,
        "run",
      ],
      {
        cwd: dirname(this.#options.paths.moonlightWebServer),
        env: {
          ...process.env,
          OPENBOT_ICE_HELPER_URL: iceEndpoint,
          OPENBOT_ICE_HELPER_TOKEN: this.#iceToken,
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    this.#pipeDiagnostics(this.#moonlight, "moonlight");
  }

  async #bootstrapMoonlight(port: number): Promise<{ hostId: number; hostIds: number[]; desktopAppId: number }> {
    const baseUrl = `http://127.0.0.1:${port}`;
    const endpointPath = join(this.#options.stateDirectory, "moonlight-endpoint.json");
    const endpoint = await readFile(endpointPath, "utf8")
      .then((text) => z.object({ port: z.number().int() }).parse(JSON.parse(text)))
      .catch(() => null);
    const endpointChanged = endpoint?.port !== this.#requireSunshineHttpPort();
    const hostIds: number[] = [];
    for (let slot = 1; slot <= MOONLIGHT_STREAMER_SLOTS; slot += 1) {
      const user = moonlightSlotUser(slot);
      const hosts = (await moonlightJson(baseUrl, "/api/hosts", moonlightHostsSchema, this.#moonlightHeader, {}, user))
        .hosts;
      this.#options.onDiagnostic?.(
        "moonlight",
        `OpenBot: found ${hosts.length} local Moonlight hosts for streamer slot ${slot}.\n`,
      );
      // Stored hosts keep their original port. Recreate the managed endpoint before pairing,
      // including when another user claimed this runtime's previous port after restart.
      for (const previous of endpointChanged ? hosts : []) {
        const deleted = await moonlightHttpResponse(
          baseUrl,
          `/api/host?host_id=${previous.host_id}`,
          { method: "DELETE" },
          user,
          this.#moonlightHeader,
        );
        deleted.resume();
      }
      let host = endpointChanged ? undefined : hosts[0];
      if (!host) {
        const created = await moonlightJson(
          baseUrl,
          "/api/host",
          moonlightCreatedHostSchema,
          this.#moonlightHeader,
          {
            method: "POST",
            body: JSON.stringify({ address: "127.0.0.1", http_port: this.#requireSunshineHttpPort() }),
          },
          user,
        );
        host = created.host;
      }
      if (host.paired !== "Paired") {
        this.#options.onDiagnostic?.(
          "moonlight",
          `OpenBot: pairing local host ${host.host_id} for streamer slot ${slot}.\n`,
        );
        await this.#pairMoonlight(baseUrl, host.host_id, user);
      }
      await this.#assertEmbeddedPermissions(baseUrl, user);
      hostIds.push(host.host_id);
    }
    const [hostId] = hostIds;
    if (hostId === undefined) throw new Error("Moonlight has no paired local host.");
    const apps = (
      await moonlightJson(
        baseUrl,
        `/api/apps?host_id=${hostId}`,
        moonlightAppsSchema,
        this.#moonlightHeader,
        {},
        moonlightSlotUser(1),
      )
    ).apps;
    const desktop = apps.find((app) => app.title.toLowerCase() === "desktop") ?? apps[0];
    if (!desktop) throw new Error("Sunshine did not publish the Desktop application.");
    await writeFile(endpointPath, JSON.stringify({ port: this.#requireSunshineHttpPort() }), { mode: 0o600 });
    return { hostId, hostIds, desktopAppId: desktop.app_id };
  }

  async #getSunshineDisplays(): Promise<RemoteDesktopDisplay[]> {
    const native = await sunshineJson(
      this.#requireSunshineHttpsPort(),
      "/api/openbot/displays",
      this.#options.credentials,
      join(this.#options.stateDirectory, "sunshine-cert.pem"),
      sunshineDisplaysSchema,
    );
    const local = this.#options.getDisplays();
    if (native.displays.length === 0) return structuredClone(local);
    return native.displays.map((display, index) => {
      const metadata = local.find((candidate) => candidate.id === display.id) ?? local[index];
      return {
        id: display.id,
        label: metadata?.label ?? display.name,
        width: metadata?.width ?? 0,
        height: metadata?.height ?? 0,
        primary: metadata?.primary ?? index === 0,
      };
    });
  }

  async #waitForPairingRequest(): Promise<string> {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const pending = await sunshineJson(
        this.#requireSunshineHttpsPort(),
        "/api/pin",
        this.#options.credentials,
        join(this.#options.stateDirectory, "sunshine-cert.pem"),
        z.object({
          pairings: z.array(
            z.object({ id: z.string().regex(/^[a-fA-F0-9]{32}$/), name: z.string(), address: z.string() }),
          ),
        }),
      );
      const matches = pending.pairings.filter(
        (pairing) =>
          pairing.name === this.#pairingName && ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(pairing.address),
      );
      const [match, ...others] = matches;
      if (others.length > 0) throw new Error("Sunshine returned ambiguous local pairing requests.");
      if (match) return match.id;
      await shortDelay();
    }
    throw new Error("Sunshine did not receive the expected local pairing request.");
  }

  async #pairMoonlight(baseUrl: string, hostId: number, user: string): Promise<void> {
    const body = JSON.stringify({ host_id: hostId });
    const response = await requestStream(
      `${baseUrl}/api/pair`,
      {
        [this.#moonlightHeader]: user,
        "Content-Type": "application/json",
        "Content-Length": String(Buffer.byteLength(body)),
      },
      body,
    );
    if (response.statusCode !== 200) {
      response.resume();
      throw new Error(`Moonlight pairing failed with HTTP ${response.statusCode ?? 0}.`);
    }
    let buffer = "";
    let pinSubmitted = false;
    for await (const chunk of response) {
      buffer += Buffer.from(chunk).toString("utf8");
      while (buffer.includes("\n")) {
        const newline = buffer.indexOf("\n");
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        const message = moonlightPairMessageSchema.parse(JSON.parse(line));
        if (message.kind === "pin") {
          this.#options.onDiagnostic?.("moonlight", "OpenBot: received local pairing PIN.\n");
          const pairingId = await this.#waitForPairingRequest();
          await sunshineRequest(
            this.#requireSunshineHttpsPort(),
            "/api/pin",
            this.#options.credentials,
            join(this.#options.stateDirectory, "sunshine-cert.pem"),
            JSON.stringify({ pairing_id: pairingId, pin: message.pin, name: "OpenBot Remote Desktop" }),
          );
          this.#options.onDiagnostic?.("moonlight", "OpenBot: submitted local pairing PIN.\n");
          pinSubmitted = true;
          continue;
        }
        if (message.kind === "paired") return;
        throw new Error("Moonlight rejected Sunshine pairing.");
      }
    }
    if (!pinSubmitted) throw new Error("Moonlight did not return a pairing PIN.");
    throw new Error("Moonlight pairing did not complete.");
  }

  async #assertEmbeddedPermissions(baseUrl: string, user: string): Promise<void> {
    const { role } = await moonlightJson(baseUrl, "/api/role", moonlightRoleSchema, this.#moonlightHeader, {}, user);
    if (role.permissions.allow_transport_webrtc !== true || role.permissions.allow_transport_websockets !== false) {
      throw new Error("Moonlight Web is not an OpenBot embedded build.");
    }
  }

  async #startIceServer(): Promise<string> {
    if (this.#iceServer) {
      const address = localAddressSchema.safeParse(this.#iceServer.address());
      if (address.success) return `http://127.0.0.1:${address.data.port}/ice`;
    }
    this.#iceToken = randomBytes(32).toString("base64url");
    this.#iceServer = createServer((request, response) => {
      if (request.url !== "/ice" || request.headers.authorization !== `Bearer ${this.#iceToken}`) {
        response.writeHead(401).end();
        return;
      }
      void Promise.resolve()
        .then(() => this.#options.getIceServers())
        .then((servers) => {
          response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
          response.end(JSON.stringify(servers.map((server) => ({ ...server, urls: arrayUrls(server.urls) }))));
        })
        .catch(() => response.writeHead(503).end());
    });
    await new Promise<void>((resolve, reject) => {
      this.#iceServer?.once("error", reject);
      this.#iceServer?.listen(0, "127.0.0.1", resolve);
    });
    const address = localAddressSchema.parse(this.#iceServer.address());
    return `http://127.0.0.1:${address.port}/ice`;
  }

  #pipeDiagnostics(process: ChildProcess, source: "sunshine" | "moonlight"): void {
    for (const stream of [process.stdout, process.stderr]) {
      // Sunshine writes to both streams and they interleave, so each keeps its own carry-over: one
      // shared between them would join a line neither printed and miss the one that matters.
      const saidCaptureDenied = createScreenCaptureDenialWatcher();
      stream?.on("data", (chunk) => {
        if (source === "sunshine" && saidCaptureDenied(chunk.toString("utf8"))) this.#screenCaptureDenied = true;
      });
      forwardDiagnosticLines(stream, (text) =>
        this.#options.onDiagnostic?.(source, text.replaceAll(this.#moonlightHeader, "[REDACTED]")),
      );
    }
  }
}

async function moonlightJson<T>(
  baseUrl: string,
  path: string,
  schema: z.ZodType<T>,
  authHeader: string,
  init: MoonlightRequestInit = {},
  user = moonlightSlotUser(1),
): Promise<T> {
  const response = await moonlightHttpResponse(baseUrl, path, init, user, authHeader);
  let buffer = "";
  for await (const chunk of response) {
    buffer += Buffer.from(chunk).toString("utf8");
    const newline = buffer.indexOf("\n");
    if (newline >= 0) {
      response.destroy();
      return schema.parse(JSON.parse(buffer.slice(0, newline)));
    }
  }
  if (!buffer.trim()) throw new Error("Moonlight returned an empty response.");
  return schema.parse(JSON.parse(buffer));
}

async function moonlightHttpResponse(
  baseUrl: string,
  path: string,
  init: MoonlightRequestInit,
  user: string,
  authHeader: string,
): Promise<IncomingMessage> {
  const body = init.body ?? "";
  const headers: Record<string, string> = {
    [authHeader]: user,
    "Content-Type": "application/json",
    ...(body ? { "Content-Length": String(Buffer.byteLength(body)) } : {}),
  };
  const response = await new Promise<IncomingMessage>((resolve, reject) => {
    const request = httpRequest(`${baseUrl}${path}`, { method: init.method ?? "GET", headers }, resolve);
    request.setTimeout(10_000, () => request.destroy(new Error("Remote desktop request timed out.")));
    request.once("error", reject);
    request.end(body);
  });
  if (!response.statusCode || response.statusCode >= 300) {
    response.resume();
    throw new Error(`Moonlight API failed with HTTP ${response.statusCode ?? 0}.`);
  }
  return response;
}

async function sunshineRequest(
  port: number,
  path: string,
  credentials: { username: string; password: string },
  certificatePath: string,
  body: string,
): Promise<void> {
  const tls = await sunshineTlsOptions(certificatePath);
  await new Promise<void>((resolve, reject) => {
    const request = https.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: "POST",
        ...tls,
        auth: `${credentials.username}:${credentials.password}`,
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      },
      (response) => {
        response.resume();
        response.on("end", () =>
          response.statusCode && response.statusCode < 300
            ? resolve()
            : reject(new SunshineApiError(response.statusCode ?? 0)),
        );
      },
    );
    request.setTimeout(10_000, () => request.destroy(new Error("Remote desktop request timed out.")));
    request.once("error", reject);
    request.end(body);
  });
}

async function sunshineJson<T>(
  port: number,
  path: string,
  credentials: { username: string; password: string },
  certificatePath: string,
  schema: z.ZodType<T>,
): Promise<T> {
  const tls = await sunshineTlsOptions(certificatePath);
  return new Promise<T>((resolve, reject) => {
    const request = https.get(
      {
        hostname: "127.0.0.1",
        port,
        path,
        ...tls,
        auth: `${credentials.username}:${credentials.password}`,
        headers: { Accept: "application/json" },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.once("error", reject);
        response.on("end", () => {
          if (!response.statusCode || response.statusCode >= 300) {
            reject(new SunshineApiError(response.statusCode ?? 0));
            return;
          }
          try {
            resolve(schema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8"))));
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    request.setTimeout(10_000, () => request.destroy(new Error("Remote desktop request timed out.")));
    request.once("error", reject);
  });
}

async function requestStream(url: string, headers: Record<string, string>, body: string): Promise<IncomingMessage> {
  return new Promise<IncomingMessage>((resolve, reject) => {
    const request = httpRequest(url, { method: "POST", headers }, resolve);
    request.setTimeout(10_000, () => request.destroy(new Error("Remote desktop request timed out.")));
    request.once("error", reject);
    request.end(body);
  });
}

async function waitForHttps(
  port: number,
  certificatePath: string,
  child?: { exitCode: number | null } | null,
): Promise<void> {
  const deadline = Date.now() + 20_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) {
      throw new Error(`Sunshine exited before its HTTPS API on port ${port} became ready.`, { cause: lastError });
    }
    try {
      const tls = await sunshineTlsOptions(certificatePath);
      await new Promise<void>((resolve, reject) => {
        const request = https.get({ hostname: "127.0.0.1", port, path: "/", ...tls }, (response) => {
          response.resume();
          resolve();
        });
        request.setTimeout(readinessAttemptTimeout(deadline), () =>
          request.destroy(new Error("Sunshine did not answer.")),
        );
        request.once("error", reject);
      });
      return;
    } catch (error) {
      lastError = error;
      await shortDelay();
    }
  }
  const detail = lastError instanceof Error ? ` ${lastError.message}` : "";
  throw new Error(`Sunshine did not become ready.${detail}`, { cause: lastError });
}

async function sunshineTlsOptions(certificatePath: string): Promise<{
  allowPartialTrustChain: true;
  ca: Buffer;
  checkServerIdentity: (hostname: string, certificate: PeerCertificate) => Error | undefined;
}> {
  const ca = await readFile(certificatePath);
  const expected = new X509Certificate(ca).raw;
  return {
    // Sunshine creates a self-signed certificate for its loopback API.
    // Treat only this pinned certificate as the local trust anchor.
    allowPartialTrustChain: true,
    ca,
    checkServerIdentity: (_hostname, certificate) => {
      const presented = certificate.raw;
      if (presented.length === expected.length && timingSafeEqual(presented, expected)) return undefined;
      return new Error("Sunshine returned an unexpected TLS certificate.");
    },
  };
}

async function waitForHttp(url: string, init: RequestInit, child?: { exitCode: number | null } | null): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) {
      throw new Error(`Moonlight Web exited before ${url} became ready.`);
    }
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(readinessAttemptTimeout(deadline)) });
      if (response.ok) return;
    } catch {
      // Retry while the local service starts.
    }
    await shortDelay();
  }
  throw new Error("Moonlight Web did not become ready.");
}

/**
 * One readiness request's limit. A service that accepts the connection and never answers would
 * otherwise hold the wait past its deadline, and the loop would not see the process exit meanwhile.
 */
function readinessAttemptTimeout(deadline: number): number {
  return Math.max(1, Math.min(READINESS_ATTEMPT_TIMEOUT_MS, deadline - Date.now()));
}

function shortDelay(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 200));
}

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = localAddressSchema.parse(server.address());
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

function arrayUrls(urls: string | string[]): string[] {
  return Array.isArray(urls) ? urls : [urls];
}

function moonlightSlotUser(slot: number): string {
  return `openbot-remote-slot-${slot}`;
}

/** Pinned Sunshine http::save_user_creds / util::Hex encoding. */
export function sunshinePasswordHash(password: string, salt: string): string {
  return createHash("sha256")
    .update(password + salt)
    .digest()
    .reverse()
    .toString("hex")
    .toUpperCase();
}
