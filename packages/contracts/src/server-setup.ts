/**
 * The setup page of a server in a container (`src/main/server-setup-page.ts`, docs/umbrel.md). The
 * main process serves it, and the `server-setup` entry of the renderer calls it.
 */

/** Each request of the page has this header with the value `1`. A form or a page of another site cannot send it. */
export const SERVER_SETUP_HEADER = "x-openbot-setup";

export const SERVER_SETUP_ROUTES = {
  status: "/api/status",
  loginStart: "/api/login/start",
  loginVerify: "/api/login/verify",
  retry: "/api/retry",
} as const;
