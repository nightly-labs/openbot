import { join } from "node:path";

export const AUTOMATION_URL_FILE = "url";
export const AUTOMATION_TOKEN_FILE = "token";
export const AUTOMATION_HEADERS_FILE = "headers";

export function automationRoot(userDataPath: string): string {
  return join(userDataPath, "automation");
}

function automationRunPath(agentId: string, routineId: string): string {
  return `/v1/agents/${encodeURIComponent(agentId)}/routines/${encodeURIComponent(routineId)}/run`;
}

interface AutomationRunCommandInput {
  root: string;
  agentId: string;
  routineId: string;
  payload: string;
  waitId?: string;
  platform: NodeJS.Platform;
}

export function automationRunCommand(input: AutomationRunCommandInput): string {
  const path = automationRunPath(input.agentId, input.routineId);
  const url = join(input.root, AUTOMATION_URL_FILE);
  const body = JSON.stringify(
    input.waitId ? { payload: input.payload, waitId: input.waitId } : { payload: input.payload },
  );
  if (input.platform === "win32") {
    return [
      "Invoke-RestMethod -Method Post",
      `-Uri ((Get-Content -Raw ${powerShellQuote(url)}).Trim() + ${powerShellQuote(path)})`,
      `-Headers @{ Authorization = 'Bearer ' + (Get-Content -Raw ${powerShellQuote(join(input.root, AUTOMATION_TOKEN_FILE))}).Trim() }`,
      `-ContentType 'application/json' -Body ${powerShellQuote(body)}`,
    ].join(" ");
  }
  return [
    `curl -sS -X POST "$(cat ${shellQuote(url)})${path}"`,
    `-H @${shellQuote(join(input.root, AUTOMATION_HEADERS_FILE))}`,
    `-H 'Content-Type: application/json' -d ${shellQuote(body)}`,
  ].join(" ");
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function powerShellQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
