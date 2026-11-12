import { mkdir, writeFile } from "node:fs/promises";
import { webContents } from "electron";
import type { BrowserHost } from "../src/backend/browser-host";
import { runCauseEffect } from "../src/backend/effect-boundary";
import type { DynamicToolCallParams } from "../src/backend/protocol";
import { bitwardenLoginFixture, runBitwardenBrowserSmoke } from "./bitwarden-browser-smoke";
import { waitForPresentedFrame } from "./browser-smoke-frames";

/** HTTPS is served inside this isolated session. No credentials or network service are used. */
export async function runSecretHandoffScenario(browser: BrowserHost, localOrigin: string): Promise<void> {
  const seed = await runCauseEffect(browser.open(localOrigin, "secret-thread", "secret-agent"));
  const seedContents = webContents.getAllWebContents().find((contents) => contents.getURL() === seed.url);
  if (!seedContents) throw new Error("Missing authentication fixture session.");
  const protocol = seedContents.session.protocol;
  /** While true, the sign-in page of the takeover view case does not load. */
  let stuckPageFails = false;
  await protocol.handle("https", async (request) => {
    const url = new URL(request.url);
    if (url.hostname !== "authentication.openbot.test") return new Response("Not found", { status: 404 });
    if (url.pathname === "/stuck" && stuckPageFails) return Response.error();
    if (url.pathname === "/bitwarden-password") return bitwardenLoginFixture("password");
    if (url.pathname === "/bitwarden-authenticator") return bitwardenLoginFixture("authenticator");
    if (url.pathname === "/confirm" || url.pathname === "/confirm-get") return confirmLoginFixture(url.pathname);
    if (url.pathname === "/confirmed") {
      const password = new URLSearchParams(await request.text()).get("password");
      return new Response(
        `<!doctype html><h1>${password === CONFIRM_PASSWORD ? "Signed in" : "Password cannot be blank"}</h1>`,
        { headers: { "Content-Type": "text/html" } },
      );
    }
    const html =
      url.pathname === "/complete"
        ? "<h1>Signed in</h1>"
        : `
      <label>Password<input id="password" type="password"></label>
      <label>Code<input id="code" inputmode="numeric"></label>
      ${
        url.pathname === "/login"
          ? `<form method="get" action="/search"><label>Search password<input id="get-password" name="password" type="password"></label></form>
      <form action="/search"><label>Default password<input id="default-password" name="password" type="password"></label></form>
      <form method="post" action="/search"><label>Override password<input id="override-password" name="password" type="password"></label><button id="override-submit" formmethod="get">Go</button></form>
      <label>One-time code<input id="otp" name="otp" type="text" autocomplete="off"></label>
      <label>MFA code<input id="totpmfa" name="totpmfa" type="text"></label>
      <label>Recovery code<input id="recovery-otp" name="recoveryOtp" type="text"></label>
      <label>SMS code<input id="sms-otp" name="smsOtp" type="text"></label>
      <label>Phone<input id="two-factor-phone" name="twoFactorPhone" type="tel"></label>
      <form method="post" action="/session"><label>Post password<input id="post-password" type="password"></label></form>
      <form method="post" action="/session"><label>Masked password<input id="masked-password" type="text" style="-webkit-text-security: disc"></label></form>
      <form action="/search" onsubmit="event.preventDefault(); location.href = '/complete'"><label>Script password<input id="script-password" name="password" type="password"></label></form>
      <form action="/search" onsubmit="event.preventDefault(); setTimeout(() => this.submit())"><label>Checked password<input id="checked-password" name="password" type="password"></label></form>`
          : ""
      }
      <div>${Array.from({ length: 6 }, (_, index) => `<input aria-label="Digit ${index + 1}" id="digit-${index}" maxlength="1">`).join("")}</div>
      <button id="submit" disabled onclick="${url.pathname === "/native-submit" ? "if (!event.isTrusted) return; " : ""}${url.pathname === "/same-page" ? "history.replaceState({}, '', '/complete')" : "location.href='/complete'"}">Sign in</button>
      <script>
      ${url.pathname === "/component" ? `const host = document.createElement('div'); document.body.append(host); const root = host.attachShadow({mode: 'open'}); root.append(...document.querySelectorAll('input'));` : ""}
      document.addEventListener('input', event => { if (${url.pathname === "/component"} && !event.isTrusted) return; ${url.pathname === "/native-submit" ? "setTimeout(() => { document.querySelector('#submit').disabled = false; }, 100);" : "document.querySelector('#submit').disabled = false;"} console.error(event.target.value); document.title = event.target.value; });</script>`;
    return new Response(`<!doctype html><body>${html}</body>`, { headers: { "Content-Type": "text/html" } });
  });
  await runCauseEffect(browser.close(seed.id));
  try {
    await runBitwardenBrowserSmoke(browser);
    for (const [method, path] of [
      ["password", "login"],
      ["otp", "login"],
      ["authenticator", "login"],
      ["password", "same-page"],
      ["password", "component"],
      ["password", "native-submit"],
    ] as const) {
      const tab = await runCauseEffect(
        browser.open(`https://authentication.openbot.test/${path}`, "secret-thread", "secret-agent"),
      );
      // The submission clicks Sign in; a tab with no frame yet would drop that click.
      const tabContents = webContents.getAllWebContents().find((contents) => contents.getURL() === tab.url);
      if (!tabContents) throw new Error(`Missing ${path} fixture.`);
      await waitForPresentedFrame(tabContents);
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
        const handoff = await runCauseEffect(browser.prepareSecret(params));
        // Only a real password field may take a vault password with no card; the digit boxes do not
        // ask for a one-time code, and an email or SMS code never comes from the vault.
        if (handoff.vaultFillable !== (method === "password"))
          throw new Error(`The ${method} fields were classified wrongly for a vault fill.`);
        for (const tool of ["snapshot", "screenshot"]) {
          const capture = await runCauseEffect(
            browser.handleDynamicTool({ ...params, tool, arguments: { tabId: tab.id } }),
          );
          if (capture.success) throw new Error("Agent capture was not blocked while awaiting consent.");
        }
        const result = await runCauseEffect(
          browser.handleDynamicTool({
            ...params,
            tool: "evaluate",
            arguments: { tabId: tab.id, expression: "document.body.innerText" },
          }),
        );
        if (result.success) throw new Error("Authentication evaluation was not blocked.");
        const secret = method === "password" ? "fixture-password-729104" : "729104";
        if ((await runCauseEffect(handoff.submit(secret, false))) !== "submitted")
          throw new Error(`Secure ${method} submission did not navigate.`);
        const snapshot = await runCauseEffect(browser.snapshot(tab.id));
        if (JSON.stringify(snapshot).includes(secret)) throw new Error("Authentication value reached a snapshot.");
        if (!snapshot.url.endsWith("/complete")) throw new Error("Authentication fixture did not complete.");
      } finally {
        await runCauseEffect(browser.close(tab.id));
      }
    }
    // A field built for something else must not take a vault password: its value can reach a URL. A
    // text field that the page masks as a password, as some bank sign-in pages do, is a password field.
    // A password field may, in any form, but a navigation that carries a vault value is blocked and the
    // user finishes. A form that the page sends with its own script, as many sign-in forms with no
    // method do, still signs in.
    const vaultPassword = "fixture vault+password/518302";
    for (const [selector, fillable, path, outcome] of [
      ["#code", false, undefined, undefined],
      ["#get-password", true, "/login", "takeover"],
      ["#default-password", true, "/login", "takeover"],
      ["#override-password", true, "/login", "takeover"],
      ["#checked-password", true, "/login", "takeover"],
      ["#post-password", true, "/session", "submitted"],
      ["#masked-password", true, "/session", "submitted"],
      ["#script-password", true, "/complete", "submitted"],
    ] as const) {
      const tab = await runCauseEffect(
        browser.open("https://authentication.openbot.test/login", "secret-thread", "secret-agent"),
      );
      try {
        const handoff = await runCauseEffect(
          browser.prepareSecret({
            namespace: "openbot_browser",
            tool: "submit_secret",
            threadId: "secret-thread",
            ownerAgentId: "secret-agent",
            turnId: "secret-turn",
            callId: `vault-${selector}`,
            arguments: {
              tabId: tab.id,
              method: "password",
              targets: [{ kind: "css", selector }],
              submission: "enter",
            },
          }),
        );
        if (handoff.vaultFillable !== fillable) {
          handoff.cancel();
          throw new Error(`${selector} was classified wrongly for a vault password.`);
        }
        if (!path) {
          handoff.cancel();
          continue;
        }
        const result = await runCauseEffect(handoff.submit(vaultPassword, true));
        const snapshot = await runCauseEffect(browser.snapshot(tab.id));
        if (new URL(snapshot.url).pathname !== path || result !== outcome)
          throw new Error(
            `A vault password in ${selector} reached ${snapshot.url} (${result}), not ${path} (${outcome}).`,
          );
      } finally {
        await runCauseEffect(browser.close(tab.id));
      }
    }
    await runResubmitScenario(browser);
    // A vault code goes only to a code field. An older Keycloak page names it otp with no
    // autocomplete="one-time-code"; a recovery, SMS, or phone field or a plain numeric field does not take it.
    for (const [selector, fillable] of [
      ["#otp", true],
      ["#totpmfa", true],
      ["#recovery-otp", false],
      ["#sms-otp", false],
      ["#two-factor-phone", false],
      ["#code", false],
    ] as const) {
      const tab = await runCauseEffect(
        browser.open("https://authentication.openbot.test/login", "secret-thread", "secret-agent"),
      );
      try {
        const handoff = await runCauseEffect(
          browser.prepareSecret({
            namespace: "openbot_browser",
            tool: "submit_secret",
            threadId: "secret-thread",
            ownerAgentId: "secret-agent",
            turnId: "secret-turn",
            callId: `vault-code-${selector}`,
            arguments: {
              tabId: tab.id,
              method: "authenticator",
              targets: [{ kind: "css", selector }],
              submission: "enter",
            },
          }),
        );
        handoff.cancel();
        if (handoff.vaultFillable !== fillable) throw new Error(`${selector} was classified wrongly for a vault code.`);
      } finally {
        await runCauseEffect(browser.close(tab.id));
      }
    }
    // A target that changes while the secret waits takes no value, also when a page adds a submitter
    // that would send the form as GET.
    for (const [selector, method, change] of [
      ["#code", "otp", "document.querySelector('#code').name = 'changed'"],
      [
        "#post-password",
        "password",
        "const button = document.createElement('button'); button.setAttribute('formmethod', 'get'); document.querySelector('#post-password').form.append(button)",
      ],
    ] as const) {
      const staleTab = await runCauseEffect(
        browser.open("https://authentication.openbot.test/login", "secret-thread", "secret-agent"),
      );
      try {
        const handoff = await runCauseEffect(
          browser.prepareSecret({
            namespace: "openbot_browser",
            tool: "submit_secret",
            threadId: "secret-thread",
            ownerAgentId: "secret-agent",
            turnId: "secret-turn",
            callId: `stale-${selector}`,
            arguments: {
              tabId: staleTab.id,
              method,
              targets: [{ kind: "css", selector }],
              submission: "on_input",
            },
          }),
        );
        const contents = webContents.getAllWebContents().find((item) => item.getURL() === staleTab.url);
        if (!contents) throw new Error("Missing stale-target fixture.");
        await contents.executeJavaScript(`${change}; true`);
        let rejected = false;
        try {
          await runCauseEffect(handoff.submit(method === "otp" ? "729104" : "fixture-password-729104", false));
        } catch {
          rejected = true;
        }
        if (!rejected) throw new Error(`A changed authentication target ${selector} was accepted.`);
        if ((await contents.executeJavaScript(`document.querySelector('${selector}').value`)) !== "")
          throw new Error(`A changed authentication target ${selector} received a value.`);
      } finally {
        await runCauseEffect(browser.close(staleTab.id));
      }
    }
    // A wrong target names itself and the reason, so the agent can correct the request.
    for (const [targets, submitTarget, expected] of [
      [
        [{ kind: "css", selector: "#password" }],
        { kind: "css", selector: "#missing-submit" },
        "submitTarget: No element matches CSS selector: #missing-submit. Correct",
      ],
      [[{ kind: "css", selector: "#submit" }], { kind: "css", selector: "#submit" }, "The field target is not"],
      [[{ kind: "css", selector: "#password" }], undefined, "submission=click needs submitTarget"],
    ] as const) {
      const wrongTab = await runCauseEffect(
        browser.open("https://authentication.openbot.test/login", "secret-thread", "secret-agent"),
      );
      try {
        const failure = await runCauseEffect(
          browser.prepareSecret({
            namespace: "openbot_browser",
            tool: "submit_secret",
            threadId: "secret-thread",
            ownerAgentId: "secret-agent",
            turnId: "secret-turn",
            callId: `wrong-${expected}`,
            arguments: {
              tabId: wrongTab.id,
              method: "password",
              targets,
              submission: "click",
              ...(submitTarget ? { submitTarget } : {}),
            },
          }),
        ).then(
          () => undefined,
          (error: unknown) => (error instanceof Error ? error.message : String(error)),
        );
        if (!failure?.includes(expected))
          throw new Error(`A wrong authentication target gave an unclear error: ${failure ?? "none"}`);
      } finally {
        await runCauseEffect(browser.close(wrongTab.id));
      }
    }
    // A submission that leaves the value in the page, and a reload that fails, keep the tab protected.
    // The live view of its takeover loads the page again, so a person on another computer can sign in
    // by hand and never sees the value.
    const stuckTab = await runCauseEffect(
      browser.open("https://authentication.openbot.test/stuck", "secret-thread", "secret-agent"),
    );
    try {
      const stuckContents = webContents.getAllWebContents().find((item) => item.getURL() === stuckTab.url);
      if (!stuckContents) throw new Error("Missing takeover view fixture.");
      const handoff = await runCauseEffect(
        browser.prepareSecret({
          namespace: "openbot_browser",
          tool: "submit_secret",
          threadId: "secret-thread",
          ownerAgentId: "secret-agent",
          turnId: "secret-turn",
          callId: "takeover-view",
          arguments: {
            tabId: stuckTab.id,
            method: "password",
            targets: [{ kind: "css", selector: "#password" }],
            submission: "on_input",
          },
        }),
      );
      const secret = "fixture-password-640271";
      stuckPageFails = true;
      const submission = await runCauseEffect(handoff.submit(secret, false)).catch(() => "failed" as const);
      stuckPageFails = false;
      const refused = await runCauseEffect(browser.startView(stuckTab.id, () => {})).then(
        async (stop) => {
          await runCauseEffect(stop());
          return false;
        },
        () => true,
      );
      await runCauseEffect(browser.beginTakeover(stuckTab.id));
      let frames = 0;
      const stopView = await runCauseEffect(
        browser.startView(stuckTab.id, () => {
          frames += 1;
        }),
      );
      try {
        const deadline = Date.now() + 10_000;
        while (frames === 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
      } finally {
        await runCauseEffect(stopView());
      }
      const page = await stuckContents.executeJavaScript(
        "JSON.stringify([document.title, document.querySelector('#password')?.value ?? null, document.body.innerText])",
        true,
      );
      browser.endTakeover(stuckTab.id);
      const report = {
        status:
          submission !== "submitted" && refused && frames > 0 && !page.includes(secret) ? "passed" : "issues_found",
        submission,
        viewRefusedBeforeTakeover: refused,
        takeoverViewFrames: frames > 0,
        secretInPage: page.includes(secret),
      };
      await mkdir(".openbot-build", { recursive: true });
      await writeFile(".openbot-build/browser-secret-takeover-view.json", JSON.stringify(report, null, 2));
      if (report.status !== "passed")
        throw new Error(`The takeover view of a protected tab is wrong: ${JSON.stringify(report)}`);
    } finally {
      await runCauseEffect(browser.close(stuckTab.id));
    }
    process.stdout.write("BrowserHost: secure password, OTP and authenticator handoff passed.\n");
  } finally {
    protocol.unhandle("https");
  }
}

const CONFIRM_PASSWORD = "fixture confirm+password/381904";

interface ResubmitCase {
  name: string;
  submission: string;
  keptInField: boolean;
  secretInSnapshots: boolean;
  evaluateBlocked: boolean;
  page: string;
  fieldAfter: "empty" | "filled" | null;
  screenshotBlocked: boolean;
  secretInAnyAddress: boolean;
}

/**
 * A sign-in page that asks whether to end the session on another device, as some company portals do,
 * and sends the same form again when the person answers Yes. The page stays the same document until then.
 */
function confirmLoginFixture(path: string): Response {
  const method = path === "/confirm-get" ? "get" : "post";
  return new Response(
    `<!doctype html><body>
    <form id="form" method="${method}" action="/confirmed">
      <label>Password<input id="password" name="password" type="password"></label>
      <button type="button" id="sign-in" onclick="document.querySelector('#question').hidden = false">Sign in</button>
      <div id="question" hidden>User logged in on another device. Continue?
        <button type="button" id="yes" onclick="document.querySelector('#form').submit()">Yes</button></div>
    </form>
    <label>Show password<input id="show" type="checkbox" onchange="document.querySelector('#password').type = this.checked ? 'text' : 'password'"></label>
    <button type="button" id="copy" onclick="const copy = document.createElement('input'); copy.value = document.querySelector('#password').value; document.body.append(copy)">Copy</button>
    <button type="button" id="yes-popup" onclick="const form = document.querySelector('#form'); form.target = '_blank'; form.submit()">Yes in a new window</button>
    </body>`,
    { headers: { "Content-Type": "text/html" } },
  );
}

/**
 * A saved password stays in its field after a submit that keeps the document, hidden from the agent,
 * so the page can send the form again. A "show password" control empties the field, and a page that
 * would send the kept password in an address is stopped.
 */
async function runResubmitScenario(browser: BrowserHost): Promise<void> {
  const call = (tool: string, args: DynamicToolCallParams["arguments"]) =>
    runCauseEffect(
      browser.handleDynamicTool({
        namespace: "openbot_browser",
        tool,
        threadId: "secret-thread",
        ownerAgentId: "secret-agent",
        turnId: "secret-turn",
        callId: `resubmit-${tool}`,
        arguments: args,
      }),
    );
  const cases: ResubmitCase[] = [];
  for (const [path, action] of [
    ["/confirm", "yes"],
    ["/confirm", "show"],
    ["/confirm", "copy"],
    ["/confirm-get", "yes"],
    ["/confirm-get", "yes-popup"],
  ] as const) {
    const tab = await runCauseEffect(
      browser.open(`https://authentication.openbot.test${path}`, "secret-thread", "secret-agent"),
    );
    try {
      const contents = webContents.getAllWebContents().find((item) => item.getURL() === tab.url);
      if (!contents) throw new Error(`Missing ${path} fixture.`);
      await waitForPresentedFrame(contents);
      const handoff = await runCauseEffect(
        browser.prepareSecret({
          namespace: "openbot_browser",
          tool: "submit_secret",
          threadId: "secret-thread",
          ownerAgentId: "secret-agent",
          turnId: "secret-turn",
          callId: `resubmit-${path}-${action}`,
          arguments: {
            tabId: tab.id,
            method: "password",
            targets: [{ kind: "css", selector: "#password" }],
            submission: "click",
            submitTarget: { kind: "css", selector: "#sign-in" },
          },
        }),
      );
      const submission = await runCauseEffect(handoff.submit(CONFIRM_PASSWORD, true));
      const keptSnapshot = await runCauseEffect(browser.snapshot(tab.id));
      const kept = await contents.executeJavaScript(
        `document.querySelector('#password').value === ${JSON.stringify(CONFIRM_PASSWORD)}`,
      );
      const evaluation = await call("evaluate", {
        tabId: tab.id,
        expression: "document.querySelector('#password').value",
      });
      await call("click", { tabId: tab.id, target: { kind: "css", selector: `#${action}` } });
      // The page sends the form with the kept password; the next snapshot reads the answer.
      if (action === "yes" && path === "/confirm" && new URL(contents.getURL()).pathname !== "/confirmed")
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("The confirmed sign-in did not load.")), 10_000);
          contents.once("did-finish-load", () => {
            clearTimeout(timer);
            resolve();
          });
        });
      const after = await runCauseEffect(browser.snapshot(tab.id));
      const screenshot = await call("screenshot", { tabId: tab.id });
      const fieldAfter =
        new URL(contents.getURL()).pathname === "/confirmed"
          ? null
          : await contents.executeJavaScript("document.querySelector('#password').value");
      const result: ResubmitCase = {
        name: `${path} ${action}`,
        submission,
        keptInField: kept === true,
        secretInSnapshots: [keptSnapshot, after].some((item) => JSON.stringify(item).includes(CONFIRM_PASSWORD)),
        evaluateBlocked: !evaluation.success,
        page: after.text.includes("Signed in")
          ? "signed-in"
          : after.text.includes("Password cannot be blank")
            ? "blank-password"
            : new URL(after.url).pathname,
        fieldAfter: fieldAfter === null ? null : fieldAfter === "" ? "empty" : "filled",
        screenshotBlocked: !screenshot.success,
        secretInAnyAddress: webContents.getAllWebContents().some((item) => item.getURL().includes("381904")),
      };
      cases.push(result);
      const expected =
        action === "show"
          ? result.fieldAfter === "empty"
          : action === "copy"
            ? result.page === "/confirm"
            : path === "/confirm"
              ? result.page === "signed-in"
              : result.page === "/confirm-get";
      if (
        !expected ||
        result.screenshotBlocked !== (action === "copy") ||
        result.secretInAnyAddress ||
        result.submission !== "submitted" ||
        !result.keptInField ||
        result.secretInSnapshots ||
        !result.evaluateBlocked
      )
        throw new Error(`A kept password failed on ${path} with ${action}: ${JSON.stringify(result)}`);
    } finally {
      await runCauseEffect(browser.close(tab.id));
    }
  }
  await mkdir(".openbot-build", { recursive: true });
  await writeFile(".openbot-build/browser-secret-resubmit.json", JSON.stringify({ status: "passed", cases }, null, 2));
}
