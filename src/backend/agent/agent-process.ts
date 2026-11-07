/**
 * The environment variable that names the agent that started a process. A provider writes it into
 * each session that it starts, so a process keeps its agent after it changes its working folder.
 */
export const AGENT_ID_VARIABLE = "OPENBOT_AGENT_ID";
