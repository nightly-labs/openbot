import { Effect } from "effect";
// @vitest-environment node

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type VoiceModelFile, VoiceModelService } from "./voice-model-service";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixtureDirectory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "openbot-voice-model-"));
  roots.push(root);
  const directory = join(root, "runtimes", "parakeet");
  await mkdir(directory, { recursive: true });
  return directory;
}

function modelFile(name: string, data: Uint8Array): VoiceModelFile {
  return {
    name,
    url: `https://downloads.example/${name}`,
    bytes: data.byteLength,
    sha256: createHash("sha256").update(data).digest("hex"),
  };
}

const encoder = new TextEncoder().encode("encoder model content");
const tokens = new TextEncoder().encode("tokens");
const files = [modelFile("encoder.onnx", encoder), modelFile("tokens.txt", tokens)];

type FetchMock = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function serviceFor(directory: string, fetchMock: FetchMock): VoiceModelService {
  return new VoiceModelService({ directory, files, fetch: fetchMock });
}

/** Serves each file by its URL. */
function serveFiles(contents: Record<string, Uint8Array<ArrayBuffer>>): FetchMock {
  return async (input) => {
    const name = String(input).split("/").at(-1) ?? "";
    const data = contents[name];
    return data ? new Response(data) : new Response(null, { status: 404 });
  };
}

describe("VoiceModelService", () => {
  it("uses a verified cached model without network access", async () => {
    const directory = await fixtureDirectory();
    await Promise.all([
      writeFile(join(directory, "encoder.onnx"), encoder),
      writeFile(join(directory, "tokens.txt"), tokens),
    ]);
    const fetchMock = vi.fn(async () => new Response());
    const service = serviceFor(directory, fetchMock);

    expect(await Effect.runPromise(service.prepare())).toEqual({ phase: "ready", progress: 100, message: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("checks again when a verified file changes on disk", async () => {
    const directory = await fixtureDirectory();
    await Promise.all([
      writeFile(join(directory, "encoder.onnx"), encoder),
      writeFile(join(directory, "tokens.txt"), tokens),
    ]);
    const service = serviceFor(directory, vi.fn(serveFiles({})));
    await expect(Effect.runPromise(service.getStatus())).resolves.toMatchObject({ phase: "ready" });

    await writeFile(join(directory, "tokens.txt"), "tokenS");
    await utimes(join(directory, "tokens.txt"), new Date(0), new Date(0));

    await expect(Effect.runPromise(service.getStatus())).resolves.toMatchObject({ phase: "missing" });
  });

  it("streams one verified download of every file for concurrent requests and reports progress", async () => {
    const directory = await fixtureDirectory();
    const fetchMock = vi.fn(serveFiles({ "encoder.onnx": encoder, "tokens.txt": tokens }));
    const service = serviceFor(directory, fetchMock);
    const progress: Array<number | null> = [];
    service.on("status", (status) => progress.push(status.progress));

    const first = Effect.runPromise(service.prepare());
    const second = Effect.runPromise(service.prepare());
    await expect(second).resolves.toEqual({ phase: "ready", progress: 100, message: null });
    await expect(first).resolves.toEqual({ phase: "ready", progress: 100, message: null });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await readFile(join(directory, "encoder.onnx"))).toEqual(Buffer.from(encoder));
    expect(await readFile(join(directory, "tokens.txt"))).toEqual(Buffer.from(tokens));
    expect(progress).toContain(100);
  });

  it("removes downloads with a bad size or hash, keeps verified files, and supports a successful retry", async () => {
    const directory = await fixtureDirectory();
    const tokensPath = join(directory, "tokens.txt");
    const fetchMock = vi
      .fn<FetchMock>()
      .mockResolvedValueOnce(new Response(encoder))
      .mockResolvedValueOnce(new Response(new TextEncoder().encode("short")))
      .mockResolvedValueOnce(new Response(new TextEncoder().encode("tokenS")))
      .mockResolvedValueOnce(new Response(tokens));
    const service = serviceFor(directory, fetchMock);

    await expect(Effect.runPromise(service.prepare())).resolves.toMatchObject({ phase: "error" });
    expect(existsSync(tokensPath)).toBe(false);
    expect(existsSync(`${tokensPath}.part`)).toBe(false);
    await expect(Effect.runPromise(service.prepare())).resolves.toMatchObject({ phase: "error" });
    expect(existsSync(tokensPath)).toBe(false);
    expect(existsSync(`${tokensPath}.part`)).toBe(false);
    await expect(Effect.runPromise(service.prepare())).resolves.toMatchObject({ phase: "ready" });
    // The encoder passed its check on the first attempt and is not downloaded again.
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("cancels an active download during shutdown and removes the partial file", async () => {
    const directory = await fixtureDirectory();
    const fetchMock = vi.fn(
      (_url: string | URL | Request, options?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => reject(new DOMException("Stopped", "AbortError")), {
            once: true,
          });
        }),
    );
    const service = serviceFor(directory, fetchMock);
    const preparation = Effect.runPromise(service.prepare());
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    await Effect.runPromise(service.shutdown());

    await expect(preparation).resolves.toEqual({
      phase: "error",
      progress: null,
      message: "Voice model download was stopped.",
    });
    expect(existsSync(join(directory, "encoder.onnx.part"))).toBe(false);
  });
});
