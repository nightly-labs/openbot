import { Effect } from "effect";
import { afterEach, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ files: new Map<string, string>(), alert: vi.fn() }));
vi.mock("react-native", () => ({ Platform: { OS: "ios" }, Alert: { alert: native.alert } }));
vi.mock("expo-application", () => ({ nativeApplicationVersion: "1.2.0" }));
vi.mock("expo-crypto", () => ({ randomUUID: () => crypto.randomUUID() }));
vi.mock("expo-file-system", () => ({
  Paths: { document: "test-documents" },
  File: class {
    readonly name: string;
    constructor(_root: string, name: string) {
      this.name = name;
    }
    get exists() {
      return native.files.has(this.name);
    }
    text() {
      return Promise.resolve(native.files.get(this.name));
    }
    write(value: string) {
      native.files.set(this.name, value);
    }
    move(destination: { name: string }) {
      const value = native.files.get(this.name);
      if (value) native.files.set(destination.name, value);
      native.files.delete(this.name);
      return Promise.resolve();
    }
  },
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("keeps native alert text local and reports error and warning presentations once", async () => {
  vi.stubGlobal("__DEV__", false);
  vi.stubEnv("EXPO_PUBLIC_APP_ENV", "production");
  vi.stubEnv("EXPO_PUBLIC_OPENPANEL_CLIENT_ID", "test-client");
  vi.stubEnv("EXPO_PUBLIC_OPENPANEL_CLIENT_SECRET", "test-write-credential");
  const bodies: string[] = [];
  vi.stubGlobal("fetch", (_url: string, options: RequestInit) => {
    bodies.push(String(options.body));
    return Promise.resolve(new Response(null, { status: 202 }));
  });
  const { mobileReportQueue, showFailureAlert, showWarningAlert } = await import("./failure-reports");
  const reports = mobileReportQueue();
  if (!reports) throw new Error("Missing report queue.");
  try {
    await Effect.runPromise(reports.configure(true, "account-1"));
    showFailureAlert(
      new Error("Invalid upload request. secret-token /private/photo.png"),
      "attachment",
      "Private title",
      "Private display text",
    );
    showWarningAlert("team", "Private host name", "Update required");
    await vi.waitFor(() => expect(bodies).toHaveLength(2));
    expect(native.alert.mock.calls).toEqual([
      ["Private title", "Private display text"],
      ["Private host name", "Update required"],
    ]);
    expect(JSON.parse(bodies[0] ?? "")).toMatchObject({
      payload: {
        name: "notification_shown",
        properties: { presentation: "alert", severity: "error", cause_code: "invalid_upload_request" },
      },
    });
    expect(JSON.parse(bodies[1] ?? "")).toMatchObject({
      payload: { properties: { presentation: "alert", severity: "warning", source: "system" } },
    });
    expect(JSON.stringify([bodies, [...native.files.values()]])).not.toMatch(
      /secret-token|private|Private|photo.png|Invalid upload|Update required/,
    );
  } finally {
    await Effect.runPromise(reports.close());
  }
});
