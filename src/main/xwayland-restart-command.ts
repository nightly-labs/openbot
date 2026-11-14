// The command that starts OpenBot again on XWayland (`linux-wayland-output.ts`). Kept apart from Electron so
// that a test can read it.

/** The process that starts again on XWayland, with its arguments and its environment. */
export interface XWaylandRestartCommand {
  file: string;
  /** The whole argument list, from `argv[0]`, as `execve` takes it. */
  argv: string[];
  env: NodeJS.ProcessEnv;
}

/**
 * The same launch on XWayland: `file`, then the arguments of this launch, then `x11Argument`. The
 * environment carries the restart marker.
 */
export function xwaylandRestartCommand(options: {
  file: string;
  environment: NodeJS.ProcessEnv;
  argv: readonly string[];
  x11Argument: string;
  marker: string;
  reason: string;
}): XWaylandRestartCommand {
  return {
    file: options.file,
    argv: [options.file, ...options.argv.slice(1), options.x11Argument],
    env: { ...options.environment, [options.marker]: options.reason },
  };
}
