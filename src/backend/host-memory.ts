export type HostMemoryLevel = "ok" | "low" | "critical";

export interface HostMemory {
  level(): HostMemoryLevel;
  turnLimit(): number;
  reserveTurn(): () => void;
  subscribe(listener: () => void): () => void;
  readonly hostedPlan: boolean;
}
