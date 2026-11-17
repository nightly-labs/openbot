/** Private host protocol. It accepts fixed routine reads, never SQL, paths or conversation text. */
export interface RoutineFlowOwnerCursor {
  updatedAt: string;
  runId: string;
}

export type RoutineFlowDiscoveryRequest =
  | { id: number; kind: "owners"; since: string; after: RoutineFlowOwnerCursor | null }
  | { id: number; kind: "results"; since: string; after: RoutineFlowOwnerCursor | null }
  | { id: number; kind: "handoffs"; since: string; after: string | null };

export interface RoutineFlowOwnerPage {
  runIds: string[];
  after: RoutineFlowOwnerCursor | null;
}

export interface RoutineFlowHandoffPage {
  runIds: string[];
  after: string | null;
}

export type RoutineFlowDiscoveryMessage =
  | { kind: "ready" }
  | { kind: "startup-failed" }
  | ({ id: number; kind: "owners" } & RoutineFlowOwnerPage)
  | ({ id: number; kind: "results" } & RoutineFlowOwnerPage)
  | ({ id: number; kind: "handoffs" } & RoutineFlowHandoffPage)
  | { id: number; kind: "failed" };

/** The packaged utility process and the isolated Node process have this same ownership seam. */
export interface RoutineFlowDiscoveryProcess {
  send(request: RoutineFlowDiscoveryRequest): void;
  onMessage(listener: (message: unknown) => void): () => void;
  onExit(listener: () => void): () => void;
  kill(): void;
}
