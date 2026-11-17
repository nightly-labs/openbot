import { describe, expect, it } from "vitest";
import { sandboxArguments } from "./local-servers";

// A server on this computer is never less sandboxed than the desktop app that starts it (#10585).
describe("sandboxArguments", () => {
  it("keeps the sandbox of a child when this process has it", () => {
    expect(sandboxArguments([])).toEqual([]);
    expect(sandboxArguments(["--ozone-platform=x11", "openbot://open"])).toEqual([]);
  });

  it("gives the child --no-sandbox only when this process started with it", () => {
    expect(sandboxArguments(["--no-sandbox", "--ozone-platform=wayland"])).toEqual(["--no-sandbox"]);
  });

  it("does not take a value after -- as a switch", () => {
    expect(sandboxArguments(["--", "--no-sandbox"])).toEqual([]);
  });

  it("does not take a similar switch as --no-sandbox", () => {
    expect(sandboxArguments(["--no-sandbox-extra", "--disable-gpu-sandbox"])).toEqual([]);
  });
});
