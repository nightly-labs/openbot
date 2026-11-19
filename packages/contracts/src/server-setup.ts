export const SERVER_SETUP_HEADER = "x-openbot-setup";

export const SERVER_SETUP_ROUTES = {
  status: "/api/status",
  loginStart: "/api/login/start",
  loginVerify: "/api/login/verify",
  retry: "/api/retry",
} as const;
