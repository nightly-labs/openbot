import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/solid-router";
import { handleBrowserApi } from "../../../server/browser-api";
import {
  remoteControlPlaneErrorResponse,
  requestAuthService,
  requestRemoteControlPlane,
  requestRemoteSignalUrl,
  requestSourceIp,
} from "../../../server/request-auth";
import { requireWorkerBindings } from "../../../server/types";

function handle({ request }: { request: Request }) {
  return handleBrowserApi(request, {
    enabled: requireWorkerBindings(env).WEB_CLIENT_ENABLED === "true",
    auth: requestAuthService(),
    remote: requestRemoteControlPlane(),
    signalUrl: requestRemoteSignalUrl,
    sourceIp: requestSourceIp,
    errorResponse: remoteControlPlaneErrorResponse,
  });
}

export const Route = createFileRoute("/api/browser/$")({ server: { handlers: { ANY: handle } } });
