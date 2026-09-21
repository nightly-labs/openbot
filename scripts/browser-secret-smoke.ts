import { webContents } from "electron";
import type { BrowserHost } from "../src/backend/browser-host";
import type { DynamicToolCallParams } from "../src/backend/protocol";

/** HTTPS is served inside this isolated session. No credentials or network service are used. */
export async function runSecretHandoffScenario(browser: BrowserHost, localOrigin: string): Promise<void> {
  const seed = await browser.open(localOrigin, "secret-thread", "secret-agent");
  const seedContents = webContents.getAllWebContents().find((contents) => contents.getURL() === seed.url);
  if (!seedContents) throw new Error("Missing authentication fixture session.");
  const protocol = seedContents.session.protocol;
  await protocol.handle("https", (request) => {
    const url = new URL(request.url);
    if (url.hostname !== "authentication.openbot.test") return new Response("Not found", { status: 404 });
    const html =
      url.pathname === "/complete"
        ? "<h1>Signed in</h1>"
        : `
      <label>Password<input id="password" type="password"></label>
      <label>Code<input id="code" inputmode="numeric"></label>
      <div>${Array.from({ length: 6 }, (_, index) => `<input aria-label="Digit ${index + 1}" id="digit-${index}" maxlength="1">`).join("")}</div>
      <button id="submit" onclick="location.href='/complete'">Sign in</button>
      <script>document.addEventListener('input', event => { console.error(event.target.value); document.title = event.target.value; });</script>`;
    return new Response(`<!doctype html><body>${html}</body>`, { headers: { "Content-Type": "text/html" } });
  });
  await browser.close(seed.id);
  try {
    for (const method of ["password", "otp", "authenticator"] as const) {
      const tab = await browser.open("https://authentication.openbot.test/login", "secret-thread", "secret-agent");
      const params: DynamicToolCallParams = {
        namespace: "openbot_browser",
        tool: "submit_secret",
        threadId: "secret-thread",
        ownerAgentId: "secret-agent",
        turnId: "secret-turn",
        callId: `secret-${method}`,
        arguments: {
          tabId: tab.id,
          method,
          targets:
            method === "authenticator"
              ? Array.from({ length: 6 }, (_, index) => ({ kind: "css", selector: `#digit-${index}` }))
              : [{ kind: "css", selector: method === "password" ? "#password" : "#code" }],
          submission: "click",
          submitTarget: { kind: "css", selector: "#submit" },
        },
      };
      try {
        const handoff = await browser.prepareSecret(params);
        for (const tool of ["snapshot", "screenshot"]) {
          const capture = await browser.handleDynamicTool({ ...params, tool, arguments: { tabId: tab.id } });
          if (capture.success) throw new Error("Agent capture was not blocked while awaiting consent.");
        }
        const result = await browser.handleDynamicTool({
          ...params,
          tool: "evaluate",
          arguments: { tabId: tab.id, expression: "document.body.innerText" },
        });
        if (result.success) throw new Error("Authentication evaluation was not blocked.");
        const secret = method === "password" ? "fixture-password-729104" : "729104";
        if ((await handoff.submit(secret)) !== "submitted")
          throw new Error(`Secure ${method} submission did not navigate.`);
        const snapshot = await browser.snapshot(tab.id);
        if (JSON.stringify(snapshot).includes(secret)) throw new Error("Authentication value reached a snapshot.");
        if (!snapshot.url.endsWith("/complete")) throw new Error("Authentication fixture did not complete.");
      } finally {
        await browser.close(tab.id);
      }
    }
    const staleTab = await browser.open("https://authentication.openbot.test/login", "secret-thread", "secret-agent");
    try {
      const handoff = await browser.prepareSecret({
        namespace: "openbot_browser",
        tool: "submit_secret",
        threadId: "secret-thread",
        ownerAgentId: "secret-agent",
        turnId: "secret-turn",
        callId: "stale",
        arguments: {
          tabId: staleTab.id,
          method: "otp",
          targets: [{ kind: "css", selector: "#code" }],
          submission: "auto",
        },
      });
      const contents = webContents.getAllWebContents().find((item) => item.getURL() === staleTab.url);
      if (!contents) throw new Error("Missing stale-target fixture.");
      await contents.executeJavaScript("document.querySelector('#code').name = 'changed'; true");
      let rejected = false;
      try {
        await handoff.submit("729104");
      } catch {
        rejected = true;
      }
      if (!rejected) throw new Error("A changed authentication target was accepted.");
      if ((await contents.executeJavaScript("document.querySelector('#code').value")) !== "")
        throw new Error("A changed authentication target received a value.");
    } finally {
      await browser.close(staleTab.id);
    }
    process.stdout.write("BrowserHost: secure password, OTP and authenticator handoff passed.\n");
  } finally {
    protocol.unhandle("https");
  }
}
