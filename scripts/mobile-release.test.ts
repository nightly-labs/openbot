import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { z } from "zod";

const root = resolve(import.meta.dirname, "..");
const workflowSchema = z.object({
  jobs: z.object({
    release: z.object({ steps: z.array(z.object({ name: z.string(), run: z.string().optional() })) }),
  }),
});
const credentialCheck = (file: string) => {
  const workflow = workflowSchema.parse(parse(readFileSync(join(root, ".github/workflows", file), "utf8")));
  const check = workflow.jobs.release.steps.find((step) => step.name === "Require release credentials")?.run;
  if (!check) throw new Error(`Release credential check is missing in ${file}`);
  return check;
};

const dispatch = (script: string) => {
  const manifest = z
    .object({ scripts: z.record(z.string(), z.string()) })
    .parse(JSON.parse(readFileSync(join(root, "package.json"), "utf8")));
  const directory = mkdtempSync(join(tmpdir(), "openbot-mobile-dispatch-"));
  try {
    writeFileSync(join(directory, "package.json"), JSON.stringify({ scripts: manifest.scripts }));
    mkdirSync(join(directory, "apps/mobile"), { recursive: true });
    writeFileSync(join(directory, "apps/mobile/package.json"), readFileSync(join(root, "apps/mobile/package.json")));
    writeFileSync(join(directory, "gh"), '#!/bin/sh\nprintf "%s\\n" "$@"\n', { mode: 0o755 });
    const output = execFileSync("bun", ["run", script], {
      cwd: directory,
      env: { ...process.env, PATH: `${directory}:${process.env.PATH}` },
      encoding: "utf8",
    });
    return output.trim().split("\n");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

const expectCredentialCheck = (check: string, environment: string, credentials: Record<string, string>) => {
  for (const name of Object.keys(credentials)) {
    const result = spawnSync("bash", ["-e", "-c", check], {
      env: { ...process.env, ...credentials, [name]: "" },
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`Missing ${environment} secrets: ${name}`);
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
};

// Executes one platform of the Fastfile with a small Fastlane DSL fake. No store request or signing occurs.
const fastlaneHarness = (platform: "ios" | "android", fakes: string) => `
  def default_platform(value); end
  def platform(value); yield if value == :${platform}; end
  def desc(value); end
  def lane(value); yield; end
  module UI
    def self.user_error!(message); raise message; end
  end
  ${fakes}
  load ARGV.fetch(0)
`;

describe("iOS release", () => {
  it("dispatches remote main without building or uploading on the caller's machine", () => {
    expect(dispatch("mobile:ios:release:testflight")).toEqual(["workflow", "run", "release-ios.yml", "--ref", "main"]);
  });

  it("stops when any credential is missing without printing credential values", () => {
    expectCredentialCheck(credentialCheck("release-ios.yml"), "release-ios", {
      EXPO_TOKEN: "test-expo-token",
      ASC_KEY_ID: "test-apple-key-id",
      ASC_ISSUER_ID: "test-apple-issuer",
      ASC_PRIVATE_KEY: "test-private-key-content",
    });
  });

  it("uploads only an existing IPA using the API key and propagates upload failures", () => {
    const directory = mkdtempSync(join(tmpdir(), "openbot-ios-upload-"));
    const ipa = join(directory, "release.ipa");
    const harness = fastlaneHarness(
      "ios",
      `
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
    `,
    );
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

describe("Android release", () => {
  it("dispatches remote main without building or uploading on the caller's machine", () => {
    expect(dispatch("mobile:android:release:play")).toEqual([
      "workflow",
      "run",
      "release-android.yml",
      "--ref",
      "main",
    ]);
  });

  it("stops when any credential is missing without printing credential values", () => {
    expectCredentialCheck(credentialCheck("release-android.yml"), "release-android", {
      EXPO_TOKEN: "test-expo-token",
      GOOGLE_PLAY_SERVICE_ACCOUNT_KEY: '{"type":"service_account","private_key":"test-private-key"}',
    });
  });

  it("uploads only an existing AAB to a testing track and propagates upload failures", () => {
    const directory = mkdtempSync(join(tmpdir(), "openbot-android-upload-"));
    const aab = join(directory, "release.aab");
    const harness = fastlaneHarness(
      "android",
      `
      def upload_to_play_store(**options)
        expected = {package_name: "run.openbot.mobile", aab: ENV.fetch("AAB_PATH"), json_key_data: "test-service-account",
          track: ENV.fetch("PLAY_TRACK"), release_status: ENV.fetch("PLAY_RELEASE_STATUS"), skip_upload_apk: true,
          skip_upload_metadata: true, skip_upload_changelogs: true, skip_upload_images: true, skip_upload_screenshots: true}
        raise "Wrong upload destination or options" unless options == expected
        raise "Google rejected the upload" if ENV["TEST_UPLOAD_FAILURE"] == "1"
        puts "uploaded #{options[:track]} #{options[:release_status]}"
      end
    `,
    );
    const run = (path: string, { track = "internal", status = "completed", fail = false } = {}) =>
      spawnSync("ruby", ["-e", harness, join(root, "apps/mobile/fastlane/Fastfile")], {
        env: {
          ...process.env,
          AAB_PATH: path,
          GOOGLE_PLAY_SERVICE_ACCOUNT_KEY: "test-service-account",
          PLAY_TRACK: track,
          PLAY_RELEASE_STATUS: status,
          TEST_UPLOAD_FAILURE: fail ? "1" : "0",
        },
        encoding: "utf8",
      });
    try {
      writeFileSync(aab, "test bundle");
      for (const [track, status] of [
        ["internal", "completed"],
        ["alpha", "draft"],
      ] as const) {
        const success = run(aab, { track, status });
        expect({ status: success.status, stdout: success.stdout, stderr: success.stderr }).toEqual({
          status: 0,
          stdout: `uploaded ${track} ${status}\n`,
          stderr: "",
        });
      }
      const other = join(directory, "release.apk");
      writeFileSync(other, "not an AAB");
      for (const invalid of [join(directory, "missing.aab"), other]) {
        const missing = run(invalid);
        expect(missing.status).toBe(1);
        expect(missing.stderr).toContain("AAB_PATH must point to an existing .aab file");
      }
      const production = run(aab, { track: "production" });
      expect(production.status).toBe(1);
      expect(production.stderr).toContain("PLAY_TRACK must be internal or alpha");
      const rejected = run(aab, { fail: true });
      expect(rejected.status).toBe(1);
      expect(rejected.stderr).toContain("Google rejected the upload");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
