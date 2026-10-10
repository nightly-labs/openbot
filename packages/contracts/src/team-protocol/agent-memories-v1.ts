// Frozen optional agent-memories-v1 contract. A member can read the memories of a visible agent.
// Pages use ascending memory ids, so editing or deleting a memory cannot shift the next page.
// The old GET route and the 2 MiB frame limit are unchanged. Each page fits even with JSON escaping.
import {
  adminRoute,
  boolean,
  count,
  empty,
  fields,
  identifier,
  list,
  nullable,
  type OptionalRouteCodec,
  oneOf,
  string,
} from "./admin-wire";

export const AGENT_MEMORIES_CAPABILITY = "agent-memories-v1";
export const AGENT_MEMORIES_PAGE_ROUTE = "/v1/agent-memories/page";
export const AGENT_MEMORIES_PAGE_SIZE = 256;
export const AGENT_MEMORY_SELECTION_PAGE_ROUTE = "/v1/agent-memories/selection";
export const AGENT_MEMORY_INCLUSION_ROUTE = "/v1/agent-memories/inclusion";
export const AGENT_MEMORY_INCLUSION_BATCH_SIZE = 25;

export const AGENT_MEMORIES_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    AGENT_MEMORY_SELECTION_PAGE_ROUTE,
    adminRoute(
      fields({ agentId: identifier, after: nullable(identifier) }),
      fields({
        agentId: identifier,
        selections: list(
          fields({
            memoryId: identifier,
            inclusion: oneOf("essential", "searchable"),
            userControlled: boolean,
            revision: count,
          }),
          256,
        ),
        usedBytes: count,
        budgetBytes: count,
        nextCursor: nullable(identifier),
      }),
    ),
  ],
  [
    AGENT_MEMORY_INCLUSION_ROUTE,
    adminRoute(
      fields({
        agentId: identifier,
        changes: list(
          fields({
            memoryId: identifier,
            inclusion: oneOf("essential", "searchable", "automatic"),
            expectedRevision: count,
          }),
          25,
        ),
      }),
      empty,
    ),
  ],
  [
    AGENT_MEMORIES_PAGE_ROUTE,
    adminRoute(
      fields({ agentId: identifier, after: nullable(identifier) }),
      fields({
        memories: list(
          fields({
            id: identifier,
            agentId: identifier,
            text: string(500),
            origin: oneOf("automatic", "manual"),
            sourceTurnId: nullable(identifier),
            createdAt: string(64),
            updatedAt: string(64),
          }),
          AGENT_MEMORIES_PAGE_SIZE,
        ),
        nextCursor: nullable(identifier),
      }),
    ),
  ],
]);
