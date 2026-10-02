import { join } from "node:path";

/** The two files the automation server writes while it runs: its base URL and its bearer token. */
export const AUTOMATION_URL_FILE = "url";
export const AUTOMATION_TOKEN_FILE = "token";

export function automationRoot(userDataPath: string): string {
  return join(userDataPath, "automation");
}

export function automationRunPath(agentId: string, routineId: string): string {
  return `/v1/agents/${encodeURIComponent(agentId)}/routines/${encodeURIComponent(routineId)}/run`;
}

interface AutomationRunCommandInput {
  root: string;
  agentId: string;
  routineId: string;
  payload: string;
  platform: NodeJS.Platform;
}

/**
 * A command that runs one routine through the automation server. It reads the URL and the token from
 * their files when it runs, so the token is never part of the command and a restart that writes new
 * files does not break a command written before it.
 */
export function automationRunCommand(input: AutomationRunCommandInput): string {
  const path = automationRunPath(input.agentId, input.routineId);
  const url = join(input.root, AUTOMATION_URL_FILE);
  const token = join(input.root, AUTOMATION_TOKEN_FILE);
  const body = JSON.stringify({ payload: input.payload });
  if (input.platform === "win32") {
    return [
      "Invoke-RestMethod -Method Post",
      `-Uri ((Get-Content -Raw ${powerShellQuote(url)}).Trim() + ${powerShellQuote(path)})`,
      `-Headers @{ Authorization = 'Bearer ' + (Get-Content -Raw ${powerShellQuote(token)}).Trim() }`,
      `-ContentType 'application/json' -Body ${powerShellQuote(body)}`,
    ].join(" ");
  }
  return [
    `curl -sS -X POST "$(cat ${shellQuote(url)})${path}"`,
    `-H "Authorization: Bearer $(cat ${shellQuote(token)})"`,
    `-H 'Content-Type: application/json' -d ${shellQuote(body)}`,
  ].join(" ");
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function powerShellQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
