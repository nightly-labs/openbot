import { parseRegistryId, parseRegistryInstall, parseRegistryQuery } from "@openbot/contracts/ipc";
import { ACP_REGISTRY_CAPABILITY, ACP_REGISTRY_ROUTES } from "@openbot/contracts/team-protocol/acp-registry-v1";
import { sourceText } from "@openbot/i18n/source";
import { redactText } from "@openbot/logging";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { TeamApiAdmin } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin } from "./request-helpers";

export async function routeAcpRegistry(
  context: TeamApiRequestContext,
  admin: TeamApiAdmin | undefined,
): Promise<RouteOutcome> {
  const { method, url, member, request, capabilities, json } = context;
  if (method !== "POST" || !Object.values(ACP_REGISTRY_ROUTES).some((path) => path === url.pathname))
    return "unmatched";
  const registry = admin?.acpRegistry;
  if (!registry || !capabilities.has(ACP_REGISTRY_CAPABILITY))
    throw new HttpError(400, sourceText("error.provider.registryUnavailable"));
  requireAdmin(member);
  const body = await readJson(request);
  try {
    switch (url.pathname) {
      case ACP_REGISTRY_ROUTES.search:
        return json(200, await runCauseEffect(registry.search(parseRegistryQuery(body.query))));
      case ACP_REGISTRY_ROUTES.installed:
        return json(200, await runCauseEffect(registry.listInstalled()));
      case ACP_REGISTRY_ROUTES.status:
        return json(200, await runCauseEffect(registry.status()));
      case ACP_REGISTRY_ROUTES.install:
        return json(200, await runCauseEffect(registry.install(parseRegistryInstall(body))));
      case ACP_REGISTRY_ROUTES.cancel:
        await runCauseEffect(registry.cancel(parseRegistryId(body.registryId)));
        return json(200, {});
      default:
        await runCauseEffect(registry.uninstall(parseRegistryId(body.registryId)));
        return json(200, {});
    }
  } catch (error) {
    throw new HttpError(
      409,
      redactText(error instanceof Error ? error.message : sourceText("error.provider.registryInstallFailed")),
    );
  }
}
