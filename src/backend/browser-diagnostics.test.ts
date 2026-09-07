import { describe, expect, it } from "vitest";
import { BrowserDiagnostics } from "./browser-diagnostics";

describe("BrowserDiagnostics", () => {
  it("keeps bounded sanitized summaries and recent action outcomes", () => {
    const diagnostics = new BrowserDiagnostics();
    for (let index = 0; index < 120; index++) {
      diagnostics.add({ kind: "network", level: index % 10 === 0 ? "error" : "info", message: `GET ${index}` });
      diagnostics.action({ action: "click", target: `ref ${index}`, outcome: index % 2 ? "success" : "error" });
    }

    const snapshot = diagnostics.snapshot();
    expect(snapshot.diagnostics).toHaveLength(50);
    expect(snapshot.actions).toHaveLength(50);
    expect(snapshot.diagnostics[0]?.message).toBe("GET 70");
    expect(snapshot.actions.at(-1)?.target).toBe("ref 119");
    expect(diagnostics.errorCount).toBe(10);

    diagnostics.clearDiagnostics();
    const cleared = diagnostics.snapshot();
    expect(cleared.diagnostics).toEqual([]);
    expect(cleared.actions).toHaveLength(50);
    expect(diagnostics.errorCount).toBe(0);
  });

  it("redacts the secrets a page can put in its own console output and action details", () => {
    const diagnostics = new BrowserDiagnostics();
    diagnostics.add({
      kind: "console",
      level: "error",
      message: "refresh failed: Authorization: Bearer sk-live-01234567890abcdef",
    });
    diagnostics.add({ kind: "network", level: "error", message: 'POST /session {"password":"hunter2"}' });
    diagnostics.action({
      action: "click",
      target: 'ref e12 "sign in as ada@example.com"',
      outcome: "error",
      detail: "Error: request rejected (api_key=sk-live-01234567890abcdef)",
    });

    const snapshot = diagnostics.snapshot();
    expect(snapshot.diagnostics[0]?.message).toBe("refresh failed: Authorization: [redacted]");
    expect(snapshot.diagnostics[1]?.message).toBe('POST /session {"password":"[redacted]"}');
    expect(snapshot.actions[0]?.target).toBe('ref e12 "sign in as [redacted-email]"');
    expect(snapshot.actions[0]?.detail).toBe("Error: request rejected (api_key=[redacted])");
  });
});
