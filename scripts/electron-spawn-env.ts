export const ELECTRON_RUNTIME_ENV_KEYS = ["ELECTRON_RUN_AS_NODE", "ELECTRON_EXTRA_LAUNCH_ARGS"] as const;

export function withoutElectronRuntimeFlags(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const child = { ...environment };
  for (const key of ELECTRON_RUNTIME_ENV_KEYS) delete child[key];
  return child;
}
