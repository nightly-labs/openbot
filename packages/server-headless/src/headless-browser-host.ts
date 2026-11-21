// HeadlessBrowserHost: implements the AgentBrowserHost surface
// (src/backend/agent/turn-lifecycle.ts:216-233) with refusals. On a headless phone
// host there is no Chromium, no display for it, and no browser feature; agent tools
// that ask for the browser get a clear error instead of a crash.
//
// This is the explicit "descarte browser" of the project goal: the 9 Electron-bound
// files under src/backend/browser-*.ts never load in this process.

export class HeadlessBrowserHost {
  readonly headless = true as const;

  private refuse(): never {
    throw new Error("browser tools are not available on the headless host");
  }

  async listTabs(): Promise<never> {
    this.refuse();
  }
  async open(): Promise<never> {
    this.refuse();
  }
  async navigate(): Promise<never> {
    this.refuse();
  }
  async close(): Promise<never> {
    this.refuse();
  }
  async screenshot(): Promise<never> {
    this.refuse();
  }
  async click(): Promise<never> {
    this.refuse();
  }
  async type(): Promise<never> {
    this.refuse();
  }
  async evaluate(): Promise<never> {
    this.refuse();
  }
}
