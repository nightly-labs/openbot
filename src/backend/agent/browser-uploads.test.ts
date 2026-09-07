// @vitest-environment node
import { readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentProvider } from "../agent-client";
import { AgentService } from "../agent-service";
import {
  FakeAgentClient,
  fakeBrowser,
  startAgentTestFixture,
  stopAgentTestFixture,
  stores,
  waitFor,
} from "../agent-service-test-harness";

let root: string;
let service: AgentService | null = null;

beforeEach(async () => {
  ({ root } = await startAgentTestFixture());
});

afterEach(async () => {
  await stopAgentTestFixture(root, service);
  service = null;
});

/**
 * A browser stub that reports what a real page would: an input identified by its CSS selector, living in
 * the document the tool call named. It reads every staged file it is handed, so a test can assert on what
 * the page would actually have seen rather than on the path alone.
 */
function uploadBrowser() {
  const staged: Array<{ path: string; contents: string; inputId: string }> = [];
  let notifyDocumentChanged: (tabId: string, documentIds: ReadonlySet<string>) => void = () => undefined;
  const targetOf = (params: unknown) => {
    const args = isDynamicRecord(params) && isDynamicRecord(params.arguments) ? params.arguments : {};
    const target = isDynamicRecord(args.target) ? args.target : {};
    const inputId = String(target.selector ?? "input");
    return { inputId, documentId: String(args.documentId ?? "main-document") };
  };
  const browser = fakeBrowser();
  browser.onDocumentChanged = (listener) => {
    notifyDocumentChanged = listener;
    return () => undefined;
  };
  browser.resolveUploadTarget = async (params) => targetOf(params);
  browser.handleDynamicTool = async (params, hooks) => {
    const { inputId, documentId } = targetOf(params);
    const paths =
      isDynamicRecord(params.arguments) && Array.isArray(params.arguments.paths) ? params.arguments.paths : [];
    for (const path of paths) {
      staged.push({ path: String(path), contents: await readFile(String(path), "utf8"), inputId });
    }
    hooks?.onUploadTargetResolved?.(inputId, documentId);
    hooks?.onUploadOperationStarted?.(Promise.resolve());
    hooks?.onUploadAssigned?.(inputId, documentId);
    return { success: true, contentItems: [] };
  };
  return {
    browser,
    staged,
    documentChanged: (tabId: string, documentIds: ReadonlySet<string>) => notifyDocumentChanged(tabId, documentIds),
  };
}

async function startService(browser: ReturnType<typeof uploadBrowser>["browser"]) {
  const clients = new Map<AgentProvider, FakeAgentClient>();
  const { store, mailbox } = stores(root);
  service = new AgentService(store, mailbox, browser, 30_000, "codex", (provider) => {
    const client = new FakeAgentClient(provider);
    clients.set(provider, client);
    return client;
  });
  await service.initialize();
  await service.sendMessage({ agentId: "chief", text: "Upload a file" });
  await waitFor(() => Boolean(store.activeProviderSession("chief")));
  const client = clients.get("codex");
  const threadId = store.activeProviderSession("chief")?.externalSessionId;
  if (!client || !threadId) throw new Error("The browser upload thread was not created.");
  return { client, threadId, workspacePath: (await store.getOrCreate("chief")).workspacePath };
}

async function upload(
  client: FakeAgentClient,
  threadId: string,
  id: string,
  args: { selector: string; paths: string[]; documentId?: string },
): Promise<void> {
  client.emit("request", {
    method: "item/tool/call",
    id,
    params: {
      threadId,
      turnId: "turn-upload",
      callId: id,
      namespace: "openbot_browser",
      tool: "upload_files",
      arguments: {
        tabId: "tab",
        target: { kind: "css", selector: args.selector },
        paths: args.paths,
        ...(args.documentId === undefined ? {} : { documentId: args.documentId }),
      },
    },
  });
  await waitFor(() => [...client.responses, ...client.errors].some((entry) => entry.id === id));
}

const missing = (path: string) =>
  readFile(path).then(
    () => false,
    () => true,
  );

describe.sequential("BrowserUploads: staging files for openbot_browser.upload_files", () => {
  it("gives the page a private copy of a file from outside the agent's workspace", async () => {
    const { browser, staged } = uploadBrowser();
    const { client, threadId } = await startService(browser);
    // Outside the workspace and the shared directory: the attachment policy would refuse this path, and
    // upload is the one tool that must accept it.
    const source = join(root, "receipt.pdf");
    await writeFile(source, "receipt bytes");

    await upload(client, threadId, "upload", { selector: "input", paths: [source] });

    expect(staged[0]?.contents).toBe("receipt bytes");
    // The page reads a copy, never the user's own file, and the name it reports is still recognizable.
    expect(staged[0]?.path).not.toBe(source);
    expect(basename(staged[0]?.path ?? "")).toBe("receipt.pdf");
    await expect(readFile(source, "utf8")).resolves.toBe("receipt bytes");
  });

  it("keeps a staged copy while its document holds the input and frees it once the document is gone", async () => {
    const { browser, staged, documentChanged } = uploadBrowser();
    const { client, threadId } = await startService(browser);
    const source = join(root, "kept.txt");
    await writeFile(source, "kept");

    await upload(client, threadId, "upload", { selector: "input", paths: [source] });
    const stagedPath = staged[0]?.path ?? "";

    documentChanged("tab", new Set(["main-document"]));
    await expect(readFile(stagedPath, "utf8")).resolves.toBe("kept");

    documentChanged("tab", new Set(["some-other-document"]));
    await waitFor(() => missing(stagedPath));
  });

  it("frees the previous copy when the same input is given different files", async () => {
    const { browser, staged } = uploadBrowser();
    const { client, threadId } = await startService(browser);
    const first = join(root, "first.txt");
    const second = join(root, "second.txt");
    await writeFile(first, "first");
    await writeFile(second, "second");

    await upload(client, threadId, "first", { selector: "input", paths: [first] });
    await upload(client, threadId, "second", { selector: "input", paths: [second] });

    await waitFor(() => missing(staged[0]?.path ?? ""));
    await expect(readFile(staged[1]?.path ?? "", "utf8")).resolves.toBe("second");
  });

  it("refuses an upload once the tab already holds files for ten inputs", async () => {
    const { browser } = uploadBrowser();
    const { client, threadId } = await startService(browser);
    const source = join(root, "quota.txt");
    await writeFile(source, "quota");

    for (let index = 0; index < 10; index++) {
      await upload(client, threadId, `input-${index}`, { selector: `#input-${index}`, paths: [source] });
    }
    expect(client.errors).toHaveLength(0);

    await upload(client, threadId, "overflow", { selector: "#overflow", paths: [source] });
    expect(client.errors).toHaveLength(1);
    expect(client.errors[0]?.id).toBe("overflow");
    // `toContain` rather than `toBe`: the client transport prefixes the serialized error with "Error: ".
    expect(client.errors[0]?.error.message).toContain("A browser tab can retain files for up to 10 inputs.");
  });

  it("frees every staged copy when the service stops", async () => {
    const { browser, staged } = uploadBrowser();
    const { client, threadId } = await startService(browser);
    const source = join(root, "leftover.txt");
    await writeFile(source, "leftover");

    await upload(client, threadId, "first", { selector: "#one", paths: [source] });
    await upload(client, threadId, "second", { selector: "#two", paths: [source] });
    const stagedPaths = staged.map((entry) => entry.path);

    await service?.stop();

    for (const path of stagedPaths) await expect(readFile(path)).rejects.toThrow();
  });
});
