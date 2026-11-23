import {
  type AgentModelOption,
  WORKFLOW_CATALOG_PROVIDERS,
  WORKFLOW_MEDIA_MODELS,
  type WorkflowCatalogSource,
  type WorkflowMediaCatalogModel,
  type WorkflowMediaModel,
  type WorkflowMediaPriceRequest,
  workflowCatalogMediaModel,
} from "@openbot/contracts/ipc";
import {
  WORKFLOWS_CREDIT_MEDIA_CAPABILITY,
  WORKFLOWS_CREDIT_MEDIA_ROUTES,
} from "@openbot/contracts/team-protocol/workflows-credit-media-v1";
import {
  WORKFLOWS_MEDIA_CATALOG_CAPABILITY,
  WORKFLOWS_MEDIA_CATALOG_ROUTES,
} from "@openbot/contracts/team-protocol/workflows-media-catalog-v1";
import {
  WORKFLOWS_MEDIA_CATALOG_V2_CAPABILITY,
  WORKFLOWS_MEDIA_CATALOG_V2_ROUTES,
} from "@openbot/contracts/team-protocol/workflows-media-catalog-v2";
import { WORKFLOWS_MEDIA_CAPABILITY } from "@openbot/contracts/team-protocol/workflows-media-v1";
import { WORKFLOWS_CAPABILITY } from "@openbot/contracts/team-protocol/workflows-v1";
import {
  decodeRemoteCreditMediaCredits,
  decodeRemoteWorkflowMediaCatalog,
  decodeRemoteWorkflowMediaPrice,
} from "@openbot/team-client/workflow-decoding";
import type { WorkspaceRequest } from "@/features/workspace/context/host-request-actions";
import {
  hasCapability,
  requireCapability,
  type ServerCapabilities,
} from "@/features/workspace/model/server-capabilities";

const NO_ENTRIES: readonly WorkflowMediaCatalogModel[] = [];

export async function loadWorkflowMediaModels({
  request,
  capabilities,
  loadAgentModels,
  serverId,
}: {
  request: WorkspaceRequest;
  capabilities: ServerCapabilities;
  loadAgentModels: (serverId: string) => Promise<AgentModelOption[]>;
  serverId: string;
}): Promise<readonly WorkflowMediaModel[]> {
  requireCapability(capabilities, serverId, WORKFLOWS_CAPABILITY, "mobile.workflow.unsupported");
  requireCapability(capabilities, serverId, WORKFLOWS_MEDIA_CAPABILITY, "mobile.workflow.media.unsupported");
  const has = (capability: string) => hasCapability(capabilities, serverId, capability);
  const catalog = async (path: string) => {
    try {
      return (await request("POST", path, decodeRemoteWorkflowMediaCatalog, {}, serverId)).models;
    } catch {
      return NO_ENTRIES;
    }
  };
  const servicePath = has(WORKFLOWS_MEDIA_CATALOG_V2_CAPABILITY)
    ? WORKFLOWS_MEDIA_CATALOG_V2_ROUTES.catalog
    : has(WORKFLOWS_MEDIA_CATALOG_CAPABILITY)
      ? WORKFLOWS_MEDIA_CATALOG_ROUTES.catalog
      : null;
  const [credit, services, agentModels] = await Promise.all([
    has(WORKFLOWS_CREDIT_MEDIA_CAPABILITY) ? catalog(WORKFLOWS_CREDIT_MEDIA_ROUTES.catalog) : NO_ENTRIES,
    servicePath ? catalog(servicePath) : NO_ENTRIES,
    loadAgentModels(serverId).catch((): AgentModelOption[] => []),
  ]);
  const listed = (entries: readonly WorkflowMediaCatalogModel[], source: WorkflowCatalogSource) =>
    entries.filter((entry) => entry.provider === source).flatMap((entry) => workflowCatalogMediaModel(entry) ?? []);
  const providers = new Set<string>(agentModels.map((model) => model.provider));
  const fixed = WORKFLOW_MEDIA_MODELS.filter(
    (model) => (model.provider === "codex" || model.provider === "grok") && providers.has(model.provider),
  );
  const service = WORKFLOW_CATALOG_PROVIDERS.flatMap((provider) => {
    const live = listed(services, provider);
    if (live.length === 0) return [];
    const ids = new Set(live.map((model) => model.id));
    return [...live, ...WORKFLOW_MEDIA_MODELS.filter((model) => model.provider === provider && !ids.has(model.id))];
  });
  return [...listed(credit, "openbot"), ...fixed, ...service];
}

export async function loadWorkflowMediaPrice({
  request,
  capabilities,
  serverId,
  input,
}: {
  request: WorkspaceRequest;
  capabilities: ServerCapabilities;
  serverId: string;
  input: WorkflowMediaPriceRequest;
}): Promise<number | null> {
  const has = (capability: string) => hasCapability(capabilities, serverId, capability);
  const path = has(WORKFLOWS_MEDIA_CATALOG_V2_CAPABILITY)
    ? WORKFLOWS_MEDIA_CATALOG_V2_ROUTES.price
    : has(WORKFLOWS_MEDIA_CATALOG_CAPABILITY)
      ? WORKFLOWS_MEDIA_CATALOG_ROUTES.price
      : null;
  if (!path) return null;
  const body = {
    model: input.model,
    kind: input.kind,
    aspect: input.aspect,
    duration: input.duration,
    resolution: input.resolution,
    transparent: input.transparent,
    ...(input.options ? { options: input.options.map((option) => ({ name: option.name, value: option.value })) } : {}),
  };
  return (await request("POST", path, decodeRemoteWorkflowMediaPrice, body, serverId)).credits;
}

export async function loadWorkflowCreditBalance({
  request,
  capabilities,
  serverId,
}: {
  request: WorkspaceRequest;
  capabilities: ServerCapabilities;
  serverId: string;
}): Promise<number | null> {
  if (!hasCapability(capabilities, serverId, WORKFLOWS_CREDIT_MEDIA_CAPABILITY)) return null;
  const credits = await request(
    "POST",
    WORKFLOWS_CREDIT_MEDIA_ROUTES.credits,
    decodeRemoteCreditMediaCredits,
    {},
    serverId,
  );
  return credits.openbot?.available ?? null;
}
