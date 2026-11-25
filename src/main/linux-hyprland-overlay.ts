import { createConnection } from "node:net";
import { join } from "node:path";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Effect, Option, Schema } from "effect";
import type { BrowserWindow } from "electron";

const logger = createOpenBotLogger("linux-hyprland-overlay");

const REQUEST_TIMEOUT = "2 seconds";
const SIZE_TOLERANCE = 2;
const OPEN_WINDOW_EVENT = "openwindow>>";

class HyprlandRequestFailure extends Schema.TaggedError<HyprlandRequestFailure>()("HyprlandRequestFailure", {
  cause: Schema.Defect(),
}) {}

const HyprlandClient = Schema.Struct({
  address: Schema.String,
  pid: Schema.Number,
  xwayland: Schema.Boolean,
  pinned: Schema.Boolean,
  size: Schema.Tuple([Schema.Number, Schema.Number]),
});
type HyprlandClient = typeof HyprlandClient.Type;

const decodeClients = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(HyprlandClient)));

function hyprlandDirectory(environment: NodeJS.ProcessEnv): string | null {
  const signature = environment.HYPRLAND_INSTANCE_SIGNATURE?.trim();
  const runtimeDirectory = environment.XDG_RUNTIME_DIR?.trim();
  if (!signature || !runtimeDirectory || signature.includes("/")) return null;
  return join(runtimeDirectory, "hypr", signature);
}

function request(directory: string, command: string): Effect.Effect<string, HyprlandRequestFailure> {
  return Effect.callback<string, HyprlandRequestFailure>((resume) => {
    const chunks: Buffer[] = [];
    let finished = false;
    const finish = (result: Effect.Effect<string, HyprlandRequestFailure>) => {
      if (finished) return;
      finished = true;
      resume(result);
    };
    const socket = createConnection(join(directory, ".socket.sock"), () => socket.end(command));
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.on("error", (cause) => finish(Effect.fail(new HyprlandRequestFailure({ cause }))));
    socket.on("close", () => finish(Effect.succeed(Buffer.concat(chunks).toString("utf8"))));
    return Effect.sync(() => {
      finished = true;
      socket.destroy();
    });
  }).pipe(
    Effect.timeoutOrElse({
      duration: REQUEST_TIMEOUT,
      orElse: () => Effect.fail(new HyprlandRequestFailure({ cause: new Error("Hyprland did not answer.") })),
    }),
  );
}

function sameSize(client: HyprlandClient, window: BrowserWindow): boolean {
  const bounds = window.getBounds();
  return (
    Math.abs(client.size[0] - bounds.width) <= SIZE_TOLERANCE &&
    Math.abs(client.size[1] - bounds.height) <= SIZE_TOLERANCE
  );
}

function overlayCommands(client: HyprlandClient): string[] {
  const target = `address:${client.address}`;
  return [
    ...(client.pinned ? [] : [`dispatch pin ${target}`]),
    `dispatch setprop ${target} no_blur 1`,
    `dispatch setprop ${target} no_shadow 1`,
  ];
}

const keepOverlayClient = Effect.fn("keepOverlayClient")(function* (
  directory: string,
  address: string,
  window: BrowserWindow,
) {
  const clients = decodeClients(yield* request(directory, "j/clients"));
  if (Option.isNone(clients) || window.isDestroyed()) return;
  const client = clients.value.find(
    (candidate) =>
      candidate.address === address &&
      candidate.pid === process.pid &&
      candidate.xwayland &&
      sameSize(candidate, window),
  );
  if (!client) return;
  for (const command of overlayCommands(client)) {
    const answer = (yield* request(directory, command)).trim();
    if (answer !== "ok") logger.warn(`Hyprland refused "${command}":`, answer);
  }
});

export function keepOverlayOnAllHyprlandWorkspaces(window: BrowserWindow, environment: NodeJS.ProcessEnv): void {
  const directory = hyprlandDirectory(environment);
  if (process.platform !== "linux" || !directory) return;
  let pending = "";
  const events = createConnection(join(directory, ".socket2.sock"));
  events.on("error", (error) => logger.warn("Could not read the Hyprland window events:", toLogValue(error)));
  events.on("data", (chunk: Buffer) => {
    const lines = (pending + chunk.toString("utf8")).split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith(OPEN_WINDOW_EVENT)) continue;
      const address = `0x${line.slice(OPEN_WINDOW_EVENT.length).split(",", 1)[0]}`;
      Effect.runFork(
        keepOverlayClient(directory, address, window).pipe(
          Effect.catch((error) =>
            Effect.sync(() =>
              logger.warn("Could not keep the window on all Hyprland workspaces:", toLogValue(error.cause)),
            ),
          ),
        ),
      );
    }
  });
  window.once("closed", () => events.destroy());
}
