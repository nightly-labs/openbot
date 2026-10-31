import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { listingsWithoutCards, outDirectoryArgument, refreshCardAfterReview, runCardCommand } from "./marketplace-card";

const [command, targetId, ...rest] = process.argv.slice(2);
const apiUrl = process.env.OPENBOT_AUTH_API_URL ?? "http://127.0.0.1:3100";
const token = process.env.SKILLS_ADMIN_TOKEN;

if (!token) throw new Error("SKILLS_ADMIN_TOKEN is required.");

const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
const api = { apiUrl, token };

if (command === "list") {
  const response = await fetch(new URL("/v1/marketplace/agents/admin/submissions", apiUrl), { headers });
  if (!response.ok) throw new Error(await response.text());
  const submissions = await response.json();
  if (!Array.isArray(submissions)) throw new Error("The API returned an invalid submissions list.");
  for (const item of submissions) {
    if (!isDynamicRecord(item) || !isString(item.id) || !isString(item.name) || !isNumber(item.version))
      throw new Error("The API returned an invalid submission.");
    process.stdout.write(
      `${item.id}\t${item.name}\tv${item.version}\t${item.skillCount} skills\t${item.routineCount} routines\n`,
    );
  }
} else if ((command === "approve" || command === "reject") && targetId) {
  const noteIndex = rest.indexOf("--note");
  const note =
    noteIndex >= 0
      ? rest
          .slice(noteIndex + 1)
          .join(" ")
          .trim()
      : undefined;
  if (command === "reject" && !note) throw new Error("Rejecting an agent requires --note <reason>.");
  // The card belongs to the listing's approved version, so it needs the agent id of this version.
  const agentId = command === "approve" ? await submissionAgentId(targetId) : null;
  const response = await fetch(
    new URL(`/v1/marketplace/agents/admin/submissions/${encodeURIComponent(targetId)}`, apiUrl),
    {
      method: "PATCH",
      headers,
      body: JSON.stringify({ status: command === "approve" ? "approved" : "rejected", ...(note ? { note } : {}) }),
    },
  );
  if (!response.ok) throw new Error(await response.text());
  process.stdout.write(`${command === "approve" ? "Approved" : "Rejected"} ${targetId}.\n`);
  if (agentId) await refreshCardAfterReview(api, "agent", agentId);
} else if (command === "feature" && targetId && (rest[0] === "on" || rest[0] === "off")) {
  const response = await fetch(
    new URL(`/v1/marketplace/agents/admin/featured/${encodeURIComponent(targetId)}`, apiUrl),
    { method: "PATCH", headers, body: JSON.stringify({ featured: rest[0] === "on" }) },
  );
  if (!response.ok) throw new Error(await response.text());
  process.stdout.write(`${rest[0] === "on" ? "Featured" : "Unfeatured"} ${targetId}.\n`);
} else if (command === "verify" && targetId && (rest[0] === "on" || rest[0] === "off")) {
  const response = await fetch(
    new URL(`/v1/marketplace/agents/admin/verified/${encodeURIComponent(targetId)}`, apiUrl),
    { method: "PATCH", headers, body: JSON.stringify({ verified: rest[0] === "on" }) },
  );
  if (!response.ok) throw new Error(await response.text());
  process.stdout.write(`${rest[0] === "on" ? "Verified" : "Unverified"} ${targetId}.\n`);
  // The card shows the shield after the name.
  await refreshCardAfterReview(api, "agent", targetId);
} else if (command === "card" && targetId) {
  await runCardCommand(api, "agent", [targetId], outDirectoryArgument(rest));
} else if (command === "cards") {
  await runCardCommand(
    api,
    "agent",
    await listingsWithoutCards(api, "agent"),
    outDirectoryArgument([targetId ?? "", ...rest]),
  );
} else {
  throw new Error(
    "Usage: bun run agents:review -- list | approve <version-id> | reject <version-id> --note <reason> | feature <agent-id> on|off | verify <agent-id> on|off | card <agent-id> [--out <dir>] | cards [--out <dir>]",
  );
}

async function submissionAgentId(versionId: string): Promise<string> {
  const response = await fetch(new URL("/v1/marketplace/agents/admin/submissions", apiUrl), { headers });
  if (!response.ok) throw new Error(await response.text());
  const submissions = await response.json();
  const submission = Array.isArray(submissions)
    ? submissions.find((item) => isDynamicRecord(item) && item.id === versionId)
    : undefined;
  if (!isDynamicRecord(submission) || !isString(submission.agentId))
    throw new Error(`No agent submission waits for review with the id ${versionId}.`);
  return submission.agentId;
}
