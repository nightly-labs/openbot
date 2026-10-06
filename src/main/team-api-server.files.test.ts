import { Effect } from "effect";
// @vitest-environment node

// Attachments, shared files and workspace files: `src/main/team-api/route-files.ts`.

import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { join } from "node:path";
import { ATTACHMENT_LIMITS } from "@openbot/contracts/input-limits";
import { afterEach, describe, expect, it } from "vitest";
import { createAgents, createTeamApiFixture, stopTeamApiFixtures } from "./team-api-server-test-harness";

afterEach(stopTeamApiFixtures);

describe("TeamApiServer files", () => {
  it("sends an attachment only to an authenticated member", async () => {
    const { root, start, signIn } = await createTeamApiFixture("attachment-read", { configure: true });
    const path = join(root, "private-image.png");
    await writeFile(path, "full attachment bytes");
    const { base } = await start({
      mailbox: {
        resolveAttachment: () => Effect.sync(() => ({ path, mimeType: "image/png", name: "private-image.png" })),
      },
    });
    const unauthorized = await fetch(`${base}/v1/attachments/image`);
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.text()).not.toContain("full attachment bytes");
    const original = await fetch(`${base}/v1/attachments/image`, {
      headers: { Authorization: `Bearer ${await signIn()}` },
    });
    expect(original.status).toBe(200);
    expect(await original.text()).toBe("full attachment bytes");
  });

  it("downloads authenticated shared files through the remote API", async () => {
    const { root, start, signIn } = await createTeamApiFixture("shared-file", { configure: true });
    const filePath = join(root, "report.csv");
    await writeFile(filePath, "name,value\nOpenBot,1\n");
    const agents = createAgents({
      resolveSharedFile: (path) =>
        Effect.sync(() => ({
          path: filePath,
          name: path.includes("large") ? "large.csv" : "report.csv",
          size: path.includes("large") ? ATTACHMENT_LIMITS.fileBytes + 1 : 21,
        })),
      resolveWorkspaceFile: (agentId, path) =>
        Effect.sync(() => ({
          path: filePath,
          name: `${agentId}-${path.split("/").at(-1)}`,
          size: 21,
          insideWorkspace: true,
        })),
    });
    const { base } = await start({ agents });

    const token = await signIn();
    const response = await fetch(`${base}/v1/shared-files?path=${encodeURIComponent("~/OpenBot/Shared/report.csv")}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain("report.csv");
    expect(await response.text()).toBe("name,value\nOpenBot,1\n");

    const oversized = await fetch(`${base}/v1/shared-files?path=${encodeURIComponent("~/OpenBot/Shared/large.csv")}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(oversized.status).toBe(413);

    const unauthorized = await fetch(`${base}/v1/shared-files?path=Shared/report.csv`);
    expect(unauthorized.status).toBe(401);

    const workspaceResponse = await fetch(
      // The released URL spells this `botId`, and the versioned adapters translate JSON bodies only,
      // so a shipped client's query string reaches the handler exactly as it was written.
      `${base}/v1/workspace-files?botId=chief&path=${encodeURIComponent("app/page.tsx")}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    expect(workspaceResponse.status).toBe(200);
    expect(workspaceResponse.headers.get("content-disposition")).toContain("chief-page.tsx");
    expect(await workspaceResponse.text()).toBe("name,value\nOpenBot,1\n");

    const unauthorizedWorkspace = await fetch(`${base}/v1/workspace-files?botId=chief&path=app/page.tsx`);
    expect(unauthorizedWorkspace.status).toBe(401);
  });

  // The routes stream files and read uploads into one array. A file of many chunks checks that the
  // released head and bytes did not change.
  it("sends and receives many-chunk files with the same head and bytes", async () => {
    const { root, start, signIn } = await createTeamApiFixture("attachment-stream", { configure: true });
    const path = join(root, "photo one.png");
    const bytes = randomBytes(1024 * 1024 + 7);
    await writeFile(path, bytes);
    const uploads: Uint8Array[] = [];
    const agents = createAgents({
      prepareImportedAttachments: (_paths, data) =>
        Effect.sync(() => {
          uploads.push(...data.map((item) => item.bytes));
          return data.map((item) => ({
            id: "draft-1",
            name: item.name,
            size: item.bytes.byteLength,
            kind: "file" as const,
            mimeType: item.mimeType,
            previewKind: "none" as const,
            previewUrl: null,
          }));
        }),
    });
    const { base } = await start({
      agents,
      mailbox: { resolveAttachment: () => Effect.sync(() => ({ path, mimeType: "image/png", name: "photo one.png" })) },
    });
    const authorization = `Bearer ${await signIn()}`;

    const download = await fetch(`${base}/v1/attachments/image`, { headers: { Authorization: authorization } });
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toBe("image/png");
    expect(download.headers.get("content-length")).toBe(String(bytes.length));
    expect(download.headers.get("content-disposition")).toBe("attachment; filename*=UTF-8''photo%20one.png");
    expect(Buffer.from(await download.arrayBuffer()).equals(bytes)).toBe(true);

    const upload = `${base}/v1/attachments?name=${encodeURIComponent("photo one.png")}&mime=image%2Fpng`;
    const sized = await fetch(upload, { method: "POST", headers: { Authorization: authorization }, body: bytes });
    expect(sized.status).toBe(201);
    // A body written in parts has no `Content-Length`, so it arrives chunked.
    const chunked = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(upload, { method: "POST", headers: { Authorization: authorization } }, (response) => {
        response.resume();
        resolve(response.statusCode);
      });
      request.on("error", reject);
      request.write(bytes.subarray(0, 1000));
      request.end(bytes.subarray(1000));
    });
    expect(chunked).toBe(201);
    expect(uploads.map((item) => Buffer.from(item).equals(bytes))).toEqual([true, true]);
  });
});
