const MIN_HIGHLIGHTS = 3;
const MAX_HIGHLIGHTS = 5;
const MAX_CONTENT = 2000;
const PLACEHOLDER = /\b(TODO|TBD|FIXME|XXX)\b/;
const MENTION = /@(everyone|here)\b|<[@#][!&]?\d+>/;
const SEND_TIMEOUT_MS = 30_000;
const ROLE_ID = /^\d{17,20}$/;
export const LONGEST_ROLE_ID = "0".repeat(20);

export function announcementFileProblems(
  announcement: string,
  version: string,
  file: string,
  message: (highlights: readonly unknown[]) => string,
): string[] {
  let record: unknown;
  try {
    record = JSON.parse(announcement);
  } catch {
    return [`${file} is not valid JSON.`];
  }
  if (typeof record !== "object" || record === null) return [`${file} is not an object.`];
  const { version: fileVersion, highlights: value }: { version?: unknown; highlights?: unknown } = record;
  const problems: string[] = [];
  if (fileVersion !== version) problems.push(`${file} is for version ${String(fileVersion)}, not ${version}.`);
  const highlights = Array.isArray(value) ? value : [];
  if (highlights.length < MIN_HIGHLIGHTS || highlights.length > MAX_HIGHLIGHTS) {
    problems.push(`${file} must have ${MIN_HIGHLIGHTS} to ${MAX_HIGHLIGHTS} highlights.`);
  }
  for (const [index, highlight] of highlights.entries()) {
    if (typeof highlight !== "string" || highlight.trim() === "") {
      problems.push(`Highlight ${index + 1} has no text.`);
    } else if (PLACEHOLDER.test(highlight)) {
      problems.push(`Highlight ${index + 1} has a placeholder.`);
    } else if (/[\r\n]/.test(highlight)) {
      problems.push(`Highlight ${index + 1} has a line break.`);
    } else if (MENTION.test(highlight)) {
      problems.push(`Highlight ${index + 1} has a mention.`);
    }
  }
  if (problems.length === 0 && message(highlights).length > MAX_CONTENT) {
    problems.push(`The message is longer than the ${MAX_CONTENT} characters that Discord accepts.`);
  }
  return problems;
}

export function roleIdProblems(name: string, roleId: string | undefined, required: boolean): string[] {
  if (!roleId) return required ? [`${name} is not set.`] : [];
  return ROLE_ID.test(roleId) ? [] : [`${name} is not a Discord role ID.`];
}

export function releaseAnchor(version: string): string {
  return `v${version.replace(/[^0-9a-z]+/gi, "-").toLowerCase()}`;
}

export interface AllowedMentions {
  parse: ("everyone" | "roles" | "users")[];
  roles?: string[];
}

export async function postAnnouncement(
  content: string,
  allowedMentions: AllowedMentions,
  webhookVariable: string,
  docs: string,
): Promise<string | undefined> {
  const webhook = process.env[webhookVariable];
  if (!webhook) return `${webhookVariable} is not set. See ${docs}.`;
  let response: Response;
  try {
    const url = new URL(webhook);
    url.searchParams.set("wait", "true");
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: "OpenBot",
        avatar_url: "https://openbot.run/icon-512x512.png",
        content,
        allowed_mentions: allowedMentions,
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch {
    return `Could not reach the Discord webhook in ${webhookVariable}, or it did not answer in time.`;
  }
  if (!response.ok) return `Discord did not post the announcement: ${response.status} ${await response.text()}`;
  return undefined;
}
