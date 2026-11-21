export function agentDisplayEnvironment(
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv = process.env,
): Readonly<Record<string, string>> {
  const display = platform === "linux" ? environment.OPENBOT_AGENT_DISPLAY : undefined;
  return display ? { DISPLAY: display } : {};
}

export function hasSeparateAgentDisplay(platform: NodeJS.Platform, environment: NodeJS.ProcessEnv = process.env) {
  return "DISPLAY" in agentDisplayEnvironment(platform, environment);
}
