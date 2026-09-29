import type { IncomingMessage, ServerResponse } from "node:http";
import { connect } from "node:http2";
import type { Plugin } from "vite";

/**
 * Local development only. Apple Push Notification service accepts HTTP/2 only, and the local
 * Worker runtime on macOS cannot open an HTTP/2 request. So the development server, which runs in
 * Node, forwards the Worker's Live Activity request to Apple. The Worker still checks the host,
 * the limit, and the payload, and signs the Apple token: only the last connection differs.
 *
 * The path is `/__dev/apns/<sandbox|production>/3/device/<token>`. Only this computer can call it.
 * It logs nothing: the request has a push token and an Apple provider token.
 */
export const DEVELOPMENT_APNS_PATH = "/__dev/apns";

const APPLE_HOSTS = {
  sandbox: "https://api.sandbox.push.apple.com",
  production: "https://api.push.apple.com",
} as const;
const FORWARDED_HEADERS = [
  "authorization",
  "apns-push-type",
  "apns-topic",
  "apns-priority",
  "apns-expiration",
  "content-type",
];
const BODY_LIMIT = 8 * 1024;
const TIMEOUT_MS = 5_000;

export function developmentApnsProxy(): Plugin {
  return {
    name: "openbot-development-apns-proxy",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(DEVELOPMENT_APNS_PATH, (request, response) => {
        void forward(request, response);
      });
    },
  };
}

async function forward(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const loopback = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.socket.remoteAddress ?? "");
  const match = /^\/(sandbox|production)(\/3\/device\/[0-9a-f]{16,512})$/u.exec(request.url ?? "");
  if (!loopback || request.method !== "POST" || !match?.[1] || !match[2]) {
    response.statusCode = 404;
    response.end();
    return;
  }
  const origin = match[1] === "sandbox" ? APPLE_HOSTS.sandbox : APPLE_HOSTS.production;
  const path = match[2];
  try {
    const body = await readBody(request);
    const result = await sendToApple(origin, path, request, body);
    response.statusCode = result.status;
    response.setHeader("content-type", "application/json");
    response.end(result.body);
  } catch {
    // The Worker reads 502 as "Apple did not accept the update now".
    response.statusCode = 502;
    response.end();
  }
}

function readBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        reject(new Error("The Live Activity request is too large."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function sendToApple(
  origin: string,
  path: string,
  request: IncomingMessage,
  body: Buffer,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const session = connect(origin);
    const timer = setTimeout(() => {
      session.destroy();
      reject(new Error("Apple did not answer in time."));
    }, TIMEOUT_MS);
    const finish = () => {
      clearTimeout(timer);
      session.close();
    };
    session.on("error", (error) => {
      finish();
      reject(error);
    });
    const headers: Record<string, string> = { ":method": "POST", ":path": path };
    for (const name of FORWARDED_HEADERS) {
      const value = request.headers[name];
      if (typeof value === "string") headers[name] = value;
    }
    const stream = session.request(headers);
    let status = 502;
    const chunks: Buffer[] = [];
    stream.on("response", (responseHeaders) => {
      status = Number(responseHeaders[":status"]) || 502;
    });
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => {
      finish();
      resolve({ status, body: Buffer.concat(chunks).toString("utf8") });
    });
    stream.on("error", (error) => {
      finish();
      reject(error);
    });
    stream.end(body);
  });
}
