import { handler, type IpcGroupHandlers } from "./define-ipc-group";

interface PluginIpcDependencies {
  /** The slug of a plugin link that arrived before a window could be told, taken exactly once. */
  takePendingPluginSlug: () => string | null;
}

/**
 * The plugin deep link, and nothing else.
 *
 * There is no install endpoint here on purpose. A link names a listing; installing it is still a
 * press of Install inside the dialog, against an agent the user picks. Adding an endpoint that
 * installed from a slug would make a web page able to install software.
 */
export function pluginIpcHandlers({ takePendingPluginSlug }: PluginIpcDependencies): Pick<IpcGroupHandlers, "plugins"> {
  return {
    plugins: {
      takePendingListing: handler(takePendingPluginSlug),
    },
  };
}
