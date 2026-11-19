import type { IncomingMessage, ServerResponse } from "node:http";
import type { AgentAccessLevel, TeamMemberSummary } from "@openbot/contracts/ipc";

export type RouteOutcome = "handled" | "unmatched";

export interface TeamApiRequestContext {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly method: string;
  readonly url: URL;
  readonly protocol: number;
  readonly capabilities: Set<string>;
  readonly member: TeamMemberSummary;
  readonly token: string;
  readonly sessionId: string;
  readonly sessionExpiresAt: string;
  readonly agentLevel: (agentId: string) => AgentAccessLevel;
  readonly json: (status: number, value: object | null) => RouteOutcome;
  readonly empty: (status: number) => RouteOutcome;
}

export interface AgentRouteTarget {
  readonly agentId: string;
  readonly action: string;
}
