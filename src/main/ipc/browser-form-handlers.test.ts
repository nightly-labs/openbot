import { type BrowserFormState, type BrowserFormSubmission, IPC_CHANNELS } from "@openbot/contracts/ipc";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { browserFormIpcHandlers } from "./browser-form-handlers";

const { registrations } = vi.hoisted(() => ({
  registrations: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
}));
vi.mock("electron", () => ({
  ipcMain: {
    handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) {
      registrations.set(channel, listener);
    },
  },
}));
const trusted = { senderFrame: { url: "openbot-app://app/index.html" } };
const input = {
  requestId: "request",
  agentId: "agent",
  threadId: "thread",
  tabId: "tab",
  revision: "revision",
  formId: "form",
  actionId: "action",
  values: [],
};
const result: BrowserFormState = { revision: "next", origin: "https://example.com", forms: [], status: "complete" };
const servers = { activeServerId: "local" };
const service = { assertBrowserTakeover: vi.fn(), respondToBrowserTakeover: vi.fn(async () => undefined) };
const browser = {
  readTakeoverForm: vi.fn(async () => result),
  submitTakeoverForm: vi.fn(async (_input: BrowserFormSubmission, check: () => void) => {
    check();
    return result;
  }),
};
function invoke(event = trusted) {
  return registrations.get(IPC_CHANNELS.browserSubmitTakeoverForm)?.(event, input);
}
beforeEach(() => {
  vi.clearAllMocks();
  servers.activeServerId = "local";
  const handlers = browserFormIpcHandlers({ browser, service, remoteServers: servers });
  handlers.readTakeoverForm(IPC_CHANNELS.browserReadTakeoverForm);
  handlers.submitTakeoverForm(IPC_CHANNELS.browserSubmitTakeoverForm);
});
describe("local browser form IPC", () => {
  it("rejects untrusted senders and remote workspaces", async () => {
    expect(() => invoke({ senderFrame: { url: "https://example.com" } })).toThrow("untrusted renderer");
    servers.activeServerId = "remote";
    await expect(invoke()).rejects.toThrow("local workspace");
    expect(browser.submitTakeoverForm).not.toHaveBeenCalled();
  });
  it("resumes only after a completed local submission", async () => {
    expect(await invoke()).toEqual(result);
    expect(service.respondToBrowserTakeover).toHaveBeenCalledWith({ requestId: "request", decision: "complete" });
    service.respondToBrowserTakeover.mockClear();
    browser.submitTakeoverForm.mockResolvedValueOnce({ ...result, status: "invalid" });
    await invoke();
    expect(service.respondToBrowserTakeover).not.toHaveBeenCalled();
  });
  it("checks the active workspace again before a queued dispatch", async () => {
    let dispatched = false;
    browser.submitTakeoverForm.mockImplementationOnce(async (_input, check) => {
      servers.activeServerId = "remote";
      check();
      dispatched = true;
      return result;
    });
    await expect(invoke()).rejects.toThrow("local workspace");
    expect(dispatched).toBe(false);
    expect(service.respondToBrowserTakeover).not.toHaveBeenCalled();
  });
});
