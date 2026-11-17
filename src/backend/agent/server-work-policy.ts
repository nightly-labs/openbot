/** Internal Thread-mode admission. Concurrency comes from the host's released task settings. */
export interface AgentServerWorkPolicy {
  maxConcurrentTasks: number;
  maxUnfinishedTasks: number;
  dispatchMode: "new-thread" | "main";
}
