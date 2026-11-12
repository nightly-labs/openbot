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
 * The same launch on XWayland: the AppImage itself where there is one, because an AppImage mounts itself
 * for each start and the mount of this process goes away with it; else this executable. The arguments of
 * this launch follow, then `x11Argument`, and the environment carries the restart marker.
 */
export function xwaylandRestartCommand(options: {
  environment: NodeJS.ProcessEnv;
  execPath: string;
  argv: readonly string[];
  x11Argument: string;
  marker: string;
  reason: string;
}): XWaylandRestartCommand {
  const file = options.environment.APPIMAGE || options.execPath;
  return {
    file,
    argv: [file, ...options.argv.slice(1), options.x11Argument],
    env: { ...options.environment, [options.marker]: options.reason },
  };
}
