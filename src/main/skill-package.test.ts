import { describe, expect, it } from "vitest";
import { isUnsafeArchivePath } from "./skill-package";

describe("isUnsafeArchivePath", () => {
  it("lets an example env file travel, because it holds no secrets", () => {
    for (const name of [".env.example", ".env.sample", ".env.template", ".env.dist", "nested/.env.example"]) {
      expect(isUnsafeArchivePath(name), name).toBe(false);
    }
  });

  it("still refuses every env file that can hold a real value", () => {
    for (const name of [".env", ".env.local", ".env.production", "nested/.env.local"]) {
      expect(isUnsafeArchivePath(name), name).toBe(true);
    }
  });

  it("keeps the other rules", () => {
    expect(isUnsafeArchivePath("")).toBe(true);
    expect(isUnsafeArchivePath("/absolute/SKILL.md")).toBe(true);
    expect(isUnsafeArchivePath("./SKILL.md")).toBe(true);
    expect(isUnsafeArchivePath(".git/config")).toBe(true);
    expect(isUnsafeArchivePath("node_modules/effect/package.json")).toBe(true);
    expect(isUnsafeArchivePath("keys/private-key.pem")).toBe(true);
    expect(isUnsafeArchivePath("bundle.zip")).toBe(true);
    expect(isUnsafeArchivePath("SKILL.md")).toBe(false);
    expect(isUnsafeArchivePath("scripts/run.ts")).toBe(false);
  });
});
