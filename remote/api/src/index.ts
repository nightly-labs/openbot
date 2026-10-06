import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Context, Effect, Layer, ManagedRuntime, Schema } from "effect";
import { createRemoteApiApp, prometheusMetrics } from "./app";
import { readRemoteApiConfig } from "./config";
import { SignalService } from "./signal-service";
import { RemoteTokenError, RemoteTokenService, signServiceRequest } from "./tokens";

const config = readRemoteApiConfig();
class ControlPlaneError extends Schema.TaggedError<ControlPlaneError>()("ControlPlaneError", {
  message: Schema.String,
}) {}

const ResumeValidation = Schema.Struct({ valid: Schema.Boolean });
const SlackValidation = Schema.Struct({ teams: Schema.Array(Schema.String) });

class ControlPlane extends Context.Service<
  ControlPlane,
  {
    validateResume(claims: import("./protocol").RemoteTicketClaims): Effect.Effect<boolean, ControlPlaneError>;
    validateSlackRoute(
      hostId: string,
      teams: import("@openbot/contracts/signal-protocol/slack-route").SlackRouteTeam[],
    ): Effect.Effect<string[], ControlPlaneError>;
  }
>()("@openbot/remote-api/ControlPlane") {
  static layer = Layer.sync(ControlPlane, () => {
    const ask = Effect.fn("ControlPlane.request")((path: string, payload: unknown) =>
      Effect.tryPromise({
        try: (signal) => {
          const body = JSON.stringify(payload);
          const timestamp = Math.floor(Date.now() / 1_000).toString();
          return fetch(new URL(path, config.controlPlaneUrl), {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "OpenBot-Timestamp": timestamp,
              "OpenBot-Signature": signServiceRequest(body, timestamp, config.authWebhookSecret),
            },
            body,
            signal: AbortSignal.any([signal, AbortSignal.timeout(5_000)]),
          });
        },
        catch: () => new ControlPlaneError({ message: "The account service request failed." }),
      }),
    );
    const readJson = (response: Response) =>
      Effect.tryPromise({
        try: () => response.json(),
        catch: () => new ControlPlaneError({ message: "The account service response is invalid." }),
      });
    const releaseResponse = (response: Response) => {
      const body = response.body;
      return body
        ? Effect.tryPromise({ try: () => body.cancel(), catch: () => undefined }).pipe(Effect.catch(() => Effect.void))
        : Effect.void;
    };
    return ControlPlane.of({
      validateResume: Effect.fn("ControlPlane.validateResume")((claims) =>
        Effect.acquireUseRelease(
          ask("/v2/remote/resume/validate", claims),
          (response) =>
            Effect.gen(function* () {
              if (!response.ok) return false;
              const result = yield* readJson(response).pipe(
                Effect.flatMap(Schema.decodeUnknownEffect(ResumeValidation)),
                Effect.mapError(() => new ControlPlaneError({ message: "The account service response is invalid." })),
              );
              return result.valid;
            }),
          releaseResponse,
        ),
      ),
      validateSlackRoute: Effect.fn("ControlPlane.validateSlackRoute")((hostId, teams) =>
        Effect.acquireUseRelease(
          ask("/v2/remote/slack-route/validate", { hostId, teams }),
          (response) =>
            Effect.gen(function* () {
              if (!response.ok)
                return yield* new ControlPlaneError({
                  message: "The account service did not confirm the Slack route.",
                });
              const result = yield* readJson(response).pipe(
                Effect.flatMap(Schema.decodeUnknownEffect(SlackValidation)),
                Effect.mapError(() => new ControlPlaneError({ message: "The account service response is invalid." })),
              );
              return [...result.teams];
            }),
          releaseResponse,
        ),
      ),
    });
  });
}

const controlPlane = ManagedRuntime.make(ControlPlane.layer);
const controlPlaneService = await controlPlane.runPromise(ControlPlane);
const tokens = new RemoteTokenService(
  config,
  (claims) =>
    controlPlaneService
      .validateResume(claims)
      .pipe(Effect.mapError((error) => new RemoteTokenError({ message: error.message }))),
  {
    validateSlackRoute: (hostId, teams) =>
      controlPlaneService
        .validateSlackRoute(hostId, teams)
        .pipe(Effect.mapError((error) => new RemoteTokenError({ message: error.message }))),
  },
);
await controlPlane.runPromise(tokens.initialize());
const signal = new SignalService(
  tokens,
  config.maximumConnectionsPerUser,
  config.maximumConnectionsPerIp,
  config.maximumMessagesPerMinute,
);
const tlsPaths =
  config.tlsCertificatePath && config.tlsPrivateKeyPath
    ? { certificate: config.tlsCertificatePath, privateKey: config.tlsPrivateKeyPath }
    : undefined;

const signalRuntime = ManagedRuntime.make(signal.dependencies);
const app = createRemoteApiApp(config, signal, signalRuntime);
const listen = () =>
  app.listen({
    hostname: config.host,
    port: config.port,
    ...(tlsPaths
      ? {
          tls: {
            cert: Bun.file(tlsPaths.certificate),
            key: Bun.file(tlsPaths.privateKey),
          },
        }
      : {}),
  });
listen();
const healthServer = Bun.serve({
  hostname: "127.0.0.1",
  port: config.healthPort,
  routes: {
    "/health/live": () => Response.json({ service: "openbot-remote-api", status: "live" }),
    "/health/ready": () => Response.json({ service: "openbot-remote-api", status: "ready" }),
    "/metrics": (request) => {
      const authorization = request.headers.get("Authorization");
      if (!config.metricsToken || authorization !== `Bearer ${config.metricsToken}`)
        return new Response("Not found", { status: 404 });
      return new Response(prometheusMetrics(signal), { headers: { "Content-Type": "text/plain; version=0.0.4" } });
    },
  },
  fetch: () => new Response("Not found", { status: 404 }),
});

const protocol = tlsPaths ? "https" : "http";
console.log(`OpenBot Remote API is ready at ${protocol}://${config.host}:${config.port}`);

const readCertificateFile = (path: string) =>
  Effect.tryPromise({
    try: (signal) => readFile(path, { signal }),
    catch: () => new ControlPlaneError({ message: "The TLS certificate could not be read." }),
  });

let certificateHash = await controlPlane.runPromise(tlsCertificateHash());
let pendingReload: Promise<void> | null = null;
let shuttingDown = false;
const certificateTimer = setInterval(() => void reloadTlsWhenChanged(), 5 * 60_000);

function reloadTlsWhenChanged(): Promise<void> {
  if (!tlsPaths || shuttingDown) return Promise.resolve();
  pendingReload ??= controlPlane
    .runPromise(reloadTlsEffect())
    .catch(() => {
      // TLS paths and provider causes must not enter diagnostics.
      console.error("OpenBot Remote API could not reload its TLS certificate.");
    })
    .finally(() => {
      pendingReload = null;
    });
  return pendingReload;
}

const reloadTlsEffect = Effect.fn("Signal.reloadTls")(function* () {
  const nextHash = yield* tlsCertificateHash();
  if (shuttingDown || !nextHash || nextHash === certificateHash) return;
  yield* Effect.tryPromise({
    try: () => app.stop(true),
    catch: () => new ControlPlaneError({ message: "The Signal listener could not be stopped." }),
  });
  if (shuttingDown) return;
  yield* Effect.try({
    try: listen,
    catch: () => new ControlPlaneError({ message: "The Signal listener could not be restarted." }),
  });
  certificateHash = nextHash;
  console.log("OpenBot Remote API reloaded its TLS certificate.");
});

function tlsCertificateHash(): Effect.Effect<string | null> {
  const certificatePath = config.tlsCertificatePath;
  const keyPath = config.tlsPrivateKeyPath;
  if (!certificatePath || !keyPath) return Effect.succeed(null);
  return Effect.all([readCertificateFile(certificatePath), readCertificateFile(keyPath)], { concurrency: 2 }).pipe(
    Effect.map(([certificate, key]) => createHash("sha256").update(certificate).update(key).digest("hex")),
    Effect.catch(() => Effect.succeed(null)),
  );
}

let pendingShutdown: Promise<void> | null = null;
const shutdown = () => {
  shuttingDown = true;
  pendingShutdown ??= (async () => {
    clearInterval(certificateTimer);
    healthServer.stop(true);
    await pendingReload;
    try {
      await app.stop(true);
    } finally {
      try {
        await signalRuntime.dispose();
        signal.close();
      } finally {
        await controlPlane.dispose();
      }
    }
    process.exit(0);
  })();
  return pendingShutdown;
};
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
