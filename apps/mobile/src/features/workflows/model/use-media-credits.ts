import {
  WORKFLOW_CATALOG_SOURCES,
  WORKFLOW_MEDIA_LEGACY_ASPECTS,
  type WorkflowMediaKind,
  type WorkflowMediaModel,
  type WorkflowMediaPriceRequest,
  type WorkflowMediaSpecs,
  type WorkflowNode,
  workflowMediaAspects,
  workflowMediaKind,
  workflowMediaModel,
  workflowMediaSpecs,
} from "@openbot/contracts/ipc";
import { isOneOf } from "@openbot/contracts/runtime-values";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { useWorkflowMediaSupported } from "@/features/workflows/model/use-workflows";
import { fieldText } from "@/features/workflows/model/workflow-node-fields";
import {
  useMobileWorkspaceActions,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";

export interface MediaChoice {
  kind: WorkflowMediaKind;
  models: WorkflowMediaModel[];
  model: WorkflowMediaModel | null | undefined;
  chosen: WorkflowMediaModel | null | undefined;
  hostAspects: ReturnType<typeof workflowMediaAspects>;
  specs: WorkflowMediaSpecs;
}

export function mediaChoice(
  node: WorkflowNode,
  catalog: readonly WorkflowMediaModel[],
  sizeHost: boolean,
): MediaChoice {
  const kind = workflowMediaKind(node.fields);
  const models = catalog.filter((option) => option.kinds.includes(kind));
  const saved = fieldText(node, "model");
  const model = workflowMediaModel(node.fields, models);
  const savedAspect = fieldText(node, "aspect");
  const hostAspects = workflowMediaAspects(model, kind).filter(
    (aspect) => sizeHost || WORKFLOW_MEDIA_LEGACY_ASPECTS.includes(aspect),
  );
  const specs = workflowMediaSpecs(
    { ...node.fields, aspect: hostAspects.some((aspect) => aspect === savedAspect) ? savedAspect : "" },
    kind,
    model,
  );
  const chosen = saved ? models.find((option) => option.id === saved) : model;
  return { kind, models, model, chosen, hostAspects, specs };
}

function priceRequest(choice: MediaChoice): WorkflowMediaPriceRequest | null {
  const { chosen, kind, specs } = choice;
  if (!chosen?.credits || !isOneOf(WORKFLOW_CATALOG_SOURCES, chosen.provider)) return null;
  const { aspect, duration, resolution, transparent, options } = specs;
  return {
    model: chosen.id,
    kind,
    aspect,
    duration,
    resolution,
    transparent,
    ...(options.length > 0 ? { options } : {}),
  };
}

export function useMediaModels(serverId: string, enabled = true) {
  const queryScope = useQueryScope();
  const { loadWorkflowMediaModels } = useMobileWorkspaceActions();
  const supported = useWorkflowMediaSupported(serverId);
  return useQuery({
    queryKey: queryKeys.workflowMediaModels(queryScope, serverId),
    queryFn: () => loadWorkflowMediaModels(serverId),
    enabled: supported && enabled,
    retry: false,
  });
}

export interface NodeCredits {
  credits: number;
  short: boolean;
}

export function useMediaCredits(serverId: string, nodes: readonly WorkflowNode[]) {
  const queryScope = useQueryScope();
  const { loadWorkflowMediaPrice, loadWorkflowCreditBalance } = useMobileWorkspaceActions();
  const sizeHost = useMobileWorkspaceSelector((current) => current.canUseWorkflowMediaSize(serverId));
  const media = nodes.filter((node) => node.kind === "image");
  const catalog = useMediaModels(serverId, media.length > 0);
  const priced = media.flatMap((node) => {
    const choice = mediaChoice(node, catalog.data ?? [], sizeHost);
    const request = priceRequest(choice);
    return request ? [{ node, choice, request }] : [];
  });
  const prices = useQueries({
    queries: priced.map(({ request }) => ({
      queryKey: queryKeys.workflowMediaPrice(queryScope, serverId, JSON.stringify(request)),
      queryFn: () => loadWorkflowMediaPrice(request, serverId),
      retry: false,
      staleTime: 60_000,
    })),
  });
  const usesBalance = priced.some(({ choice }) => choice.chosen?.provider === "openbot");
  const balance = useQuery({
    queryKey: queryKeys.workflowCreditBalance(queryScope, serverId),
    queryFn: () => loadWorkflowCreditBalance(serverId),
    enabled: usesBalance,
    retry: false,
  });
  const available = usesBalance ? (balance.data ?? null) : null;
  const byNode = new Map<string, NodeCredits>();
  priced.forEach(({ node, choice }, index) => {
    const credits = prices[index]?.data;
    if (typeof credits !== "number") return;
    const counted = choice.chosen?.provider === "openbot" ? available : null;
    byNode.set(node.id, { credits, short: counted !== null && credits > counted });
  });
  const total = byNode.size > 0 ? [...byNode.values()].reduce((sum, entry) => sum + entry.credits, 0) : null;
  return { byNode, total, available, catalog };
}
