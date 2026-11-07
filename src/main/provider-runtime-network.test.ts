// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const netFetch = vi.hoisted(() => vi.fn());

vi.mock("electron", () => ({ net: { fetch: netFetch } }));

import { providerRuntimeFetch } from "./provider-runtime-network";

describe("provider runtime fetch", () => {
  beforeEach(() => {
    netFetch.mockReset();
  });

  it("is not the global fetch", () => {
    expect(providerRuntimeFetch).not.toBe(globalThis.fetch);
  });

  it("passes a URL as a string and keeps the init", async () => {
    const response = new Response("proxied");
    netFetch.mockResolvedValue(response);
    const init = { headers: { Range: "bytes=1024-" }, signal: new AbortController().signal };

    await expect(providerRuntimeFetch(new URL("https://example.test/runtime.zip"), init)).resolves.toBe(response);

    expect(netFetch).toHaveBeenCalledTimes(1);
    expect(netFetch).toHaveBeenCalledWith("https://example.test/runtime.zip", init);
  });

  it("passes a string and a Request through unchanged", async () => {
    netFetch.mockResolvedValue(new Response(""));
    const url = "https://example.test/runtime.zip";
    const request = new Request(url);

    await providerRuntimeFetch(url);
    await providerRuntimeFetch(request);

    expect(netFetch).toHaveBeenNthCalledWith(1, url, undefined);
    expect(netFetch).toHaveBeenNthCalledWith(2, request, undefined);
  });

  it("rejects a non-https URL before it reaches net.fetch", async () => {
    for (const url of [
      "http://example.test/runtime.zip",
      "file:///tmp/runtime.zip",
      "openbot://runtime.zip",
      "not a url",
    ]) {
      await expect(providerRuntimeFetch(url)).rejects.toThrow("https URL");
    }

    expect(netFetch).not.toHaveBeenCalled();
  });

  it("rejects a Request with a non-https URL", async () => {
    await expect(providerRuntimeFetch(new Request("http://example.test/runtime.zip"))).rejects.toThrow("https URL");

    expect(netFetch).not.toHaveBeenCalled();
  });
});
