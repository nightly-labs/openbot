// The device sign-in reads the page and the code from what a provider's CLI prints. The first sample is the
// output that Kiro CLI 2.37.1 gave for `kiro-cli login --use-device-flow` with no terminal.
import { describe, expect, it } from "vitest";
import { parseCliCodePrompt } from "./cli-code-login";

const KIRO = [
  "",
  "Confirm the following code in the browser",
  "Code: KPRJ-BGST",
  "",
  "Open this URL: https://view.awsapps.com/start/#/device?user_code=KPRJ-BGST",
  "",
].join("\n");

describe("parseCliCodePrompt, device flow", () => {
  it("reads the code and the page of Kiro CLI", () => {
    expect(parseCliCodePrompt("device", KIRO)).toEqual({
      flow: "device",
      userCode: "KPRJ-BGST",
      verificationUrl: "https://view.awsapps.com/start/#/device?user_code=KPRJ-BGST",
      verificationUrlComplete: null,
    });
  });

  it("reads Kiro's output with the spinner that follows it", () => {
    const spinner = "\u001b[?25l\r▰▱▱▱▱▱▱ Logging in...\r▰▰▱▱▱▱▱ Logging in...";
    expect(parseCliCodePrompt("device", `${KIRO}${spinner}`)).toMatchObject({ userCode: "KPRJ-BGST" });
  });

  it("waits for the whole code: the last line has no newline yet", () => {
    expect(parseCliCodePrompt("device", "Confirm the following code in the browser\nCode: KPRJ-BG")).toBeNull();
  });

  it("waits for the page when the code came first", () => {
    expect(parseCliCodePrompt("device", "Confirm the following code in the browser\nCode: KPRJ-BGST\n\n")).toBeNull();
  });

  it("does not take a line that is not a code", () => {
    const text = KIRO.replace("Code: KPRJ-BGST", "Code: please wait while the page loads");
    expect(parseCliCodePrompt("device", text)).toBeNull();
  });

  it("still reads the shapes of other CLIs", () => {
    const grok = "Confirm this code\nABCD-1234\n\nhttps://accounts.x.ai/device\n";
    expect(parseCliCodePrompt("device", grok)).toMatchObject({ userCode: "ABCD-1234" });
    const copilot = "To authenticate, visit https://github.com/login/device and enter code 8F43-6FCF\n";
    expect(parseCliCodePrompt("device", copilot)).toMatchObject({
      userCode: "8F43-6FCF",
      verificationUrl: "https://github.com/login/device",
    });
  });
});
