import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { z } from "zod";

const root = resolve(import.meta.dirname, "..");
const workflow = z
  .object({
    jobs: z.object({
      release: z.object({ steps: z.array(z.object({ name: z.string(), run: z.string().optional() })) }),
    }),
  })
  .parse(parse(readFileSync(join(root, ".github/workflows/release-ios.yml"), "utf8")));

describe("iOS release", () => {
  it("dispatches remote main without building or uploading on the caller's machine", () => {
    const manifest = z
      .object({ scripts: z.record(z.string(), z.string()) })
      .parse(JSON.parse(readFileSync(join(root, "package.json"), "utf8")));
    const directory = mkdtempSync(join(tmpdir(), "openbot-ios-dispatch-"));
    try {
      writeFileSync(join(directory, "package.json"), JSON.stringify({ scripts: manifest.scripts }));
      mkdirSync(join(directory, "apps/mobile"), { recursive: true });
      writeFileSync(join(directory, "apps/mobile/package.json"), readFileSync(join(root, "apps/mobile/package.json")));
      writeFileSync(join(directory, "gh"), '#!/bin/sh\nprintf "%s\\n" "$@"\n', { mode: 0o755 });
      const output = execFileSync("bun", ["run", "mobile:ios:release:testflight"], {
        cwd: directory,
        env: { ...process.env, PATH: `${directory}:${process.env.PATH}` },
        encoding: "utf8",
      });
      expect(output.trim().split("\n")).toEqual(["workflow", "run", "release-ios.yml", "--ref", "main"]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("stops when any credential is missing without printing credential values", () => {
    const check = workflow.jobs.release.steps.find((step) => step.name === "Require release credentials")?.run;
    if (!check) throw new Error("Release credential check is missing");
    const credentials = {
      EXPO_TOKEN: "test-expo-token",
      ASC_KEY_ID: "test-apple-key-id",
      ASC_ISSUER_ID: "test-apple-issuer",
      ASC_PRIVATE_KEY: "test-private-key-content",
    };
    for (const name of Object.keys(credentials)) {
      const result = spawnSync("bash", ["-e", "-c", check], {
        env: { ...process.env, ...credentials, [name]: "" },
        encoding: "utf8",
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`Missing release-ios secrets: ${name}`);
      for (const value of Object.values(credentials)) {
        expect(result.stdout + result.stderr).not.toContain(value);
      }
    }
    const valid = spawnSync("bash", ["-e", "-c", check], {
      env: { ...process.env, ...credentials },
      encoding: "utf8",
    });
    expect(valid.status).toBe(0);
    expect(valid.stdout + valid.stderr).toBe("");
  });

  it("uploads only an existing IPA using the API key and propagates upload failures", () => {
    const directory = mkdtempSync(join(tmpdir(), "openbot-ios-upload-"));
    const ipa = join(directory, "release.ipa");
    // Execute the Fastfile with a small Fastlane DSL fake. No Apple request or signing occurs.
    const harness = `
      def default_platform(value); end
      def platform(value); yield; end
      def desc(value); end
      def lane(value); yield; end
      module UI
        def self.user_error!(message); raise message; end
      end
      def app_store_connect_api_key(**options)
        expected = {key_id: "test-id", issuer_id: "test-issuer", key_content: "test-private-key", in_house: false}
        raise "Wrong API credentials" unless options == expected
        {token: "fake-token"}
      end
      def upload_to_testflight(**options)
        expected = {api_key: {token: "fake-token"}, ipa: ENV.fetch("IPA_PATH"),
          app_identifier: "run.openbot.mobile", skip_waiting_for_build_processing: true, distribute_external: false}
        raise "Wrong upload destination or options" unless options == expected
        raise "Apple rejected the upload" if ENV["TEST_UPLOAD_FAILURE"] == "1"
        puts "uploaded"
      end
      load ARGV.fetch(0)
    `;
    const run = (path: string, fail = false) =>
      spawnSync("ruby", ["-e", harness, join(root, "apps/mobile/fastlane/Fastfile")], {
        env: {
          ...process.env,
          IPA_PATH: path,
          ASC_KEY_ID: "test-id",
          ASC_ISSUER_ID: "test-issuer",
          ASC_PRIVATE_KEY: "test-private-key",
          TEST_UPLOAD_FAILURE: fail ? "1" : "0",
        },
        encoding: "utf8",
      });
    try {
      writeFileSync(ipa, "test archive");
      const success = run(ipa);
      expect({ status: success.status, stdout: success.stdout, stderr: success.stderr }).toEqual({
        status: 0,
        stdout: "uploaded\n",
        stderr: "",
      });
      const other = join(directory, "release.txt");
      writeFileSync(other, "not an IPA");
      for (const invalid of [join(directory, "missing.ipa"), other]) {
        const missing = run(invalid);
        expect(missing.status).toBe(1);
        expect(missing.stderr).toContain("IPA_PATH must point to an existing .ipa file");
      }
      const rejected = run(ipa, true);
      expect(rejected.status).toBe(1);
      expect(rejected.stderr).toContain("Apple rejected the upload");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
