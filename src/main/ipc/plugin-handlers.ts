import { handler, type IpcGroupHandlers } from "./define-ipc-group";

interface PluginIpcDependencies {
  takePendingPluginSlug: () => string | null;
}

export function pluginIpcHandlers({ takePendingPluginSlug }: PluginIpcDependencies): Pick<IpcGroupHandlers, "plugins"> {
  return {
    plugins: {
      takePendingListing: handler(takePendingPluginSlug),
    },
  };
}
