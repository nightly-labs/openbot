import { mkdir, writeFile } from "node:fs/promises";
import { webContents } from "electron";
import { z } from "zod";
import type { BrowserHost } from "../src/backend/browser-host";
import { runCauseEffect } from "../src/backend/effect-boundary";
import type { DynamicToolCallParams } from "../src/backend/protocol";
import { bitwardenLoginFixture, runBitwardenBrowserSmoke } from "./bitwarden-browser-smoke";
import { waitForPresentedFrame } from "./browser-smoke-frames";

const FRAME_HOSTS = ["login.openbot.test", "login.other-site.test"];
const FRAME_PASSWORD = "fixture-frame-password-201938";

async function runFrameScenario(browser: BrowserHost): Promise<void> {
  const report: {
    vaultOrigin?: string;
    vaultFillable?: boolean;
    submission?: string;
    completed?: boolean;
    snapshotHasValue?: boolean;
    otherSiteRefused?: boolean;
  } = {};
  for (const path of ["framed", "framed-other"] as const) {
    const tab = await runCauseEffect(
      browser.open(`https://authentication.openbot.test/${path}`, "secret-thread", "secret-agent"),
    );
    try {
      const contents = webContents.getAllWebContents().find((item) => item.getURL() === tab.url);
      if (!contents) throw new Error(`Missing ${path} fixture.`);
      await waitForPresentedFrame(contents);
      const deadline = Date.now() + 10_000;
      let read = await runCauseEffect(browser.snapshot(tab.id));
      const element = (name: string) => read.elements.find((item) => item.name === name);
      while ((!element("Frame password") || !element("Frame sign in")) && Date.now() < deadline) {
        await new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(timer);
            contents.off("did-frame-finish-load", done);
            resolve();
          };
          const timer = setTimeout(done, Math.max(0, deadline - Date.now()));
          contents.once("did-frame-finish-load", done);
        });
        read = await runCauseEffect(browser.snapshot(tab.id));
      }
      const password = element("Frame password");
      const submit = element("Frame sign in");
      if (!password || !submit) throw new Error(`The ${path} snapshot does not show the frame's fields.`);
      const prepared = await runCauseEffect(
        browser.prepareSecret({
          namespace: "openbot_browser",
          tool: "submit_secret",
          threadId: "secret-thread",
          ownerAgentId: "secret-agent",
          turnId: "secret-turn",
          callId: `frame-${path}`,
          arguments: {
            tabId: tab.id,
            method: "password",
            targets: [{ kind: "ref", ref: password.ref, revision: read.revision }],
            submission: "click",
            submitTarget: { kind: "ref", ref: submit.ref, revision: read.revision },
          },
        }),
      ).then(
        (handoff) => ({ handoff, error: null }),
        (error: unknown) => ({ handoff: null, error: error instanceof Error ? error.message : String(error) }),
      );
      if (path === "framed-other") {
        report.otherSiteRefused = prepared.error?.includes("frame of another site") === true;
        continue;
      }
      if (!prepared.handoff) throw new Error(`Secure fill refused the same-site frame: ${prepared.error}`);
      report.vaultOrigin = prepared.handoff.request.origin;
      report.vaultFillable = prepared.handoff.vaultFillable;
      report.submission = await runCauseEffect(prepared.handoff.submit(FRAME_PASSWORD, true));
      const after = await runCauseEffect(browser.snapshot(tab.id));
      report.completed = after.url.endsWith("/complete");
      report.snapshotHasValue = JSON.stringify(after).includes(FRAME_PASSWORD);
    } finally {
      await runCauseEffect(browser.close(tab.id));
    }
  }
  const passed =
    report.vaultOrigin === `https://${FRAME_HOSTS[0]}` &&
    report.vaultFillable === true &&
    report.submission === "submitted" &&
    report.completed === true &&
    report.snapshotHasValue === false &&
    report.otherSiteRefused === true;
  await mkdir(".openbot-build", { recursive: true });
  await writeFile(
    ".openbot-build/browser-secret-frame.json",
    JSON.stringify({ status: passed ? "passed" : "issues_found", ...report }, null, 2),
  );
  if (!passed) throw new Error(`Secure fill in a frame is wrong: ${JSON.stringify(report)}`);
}

export async function runSecretHandoffScenario(browser: BrowserHost, localOrigin: string): Promise<void> {
  const seed = await runCauseEffect(browser.open(localOrigin, "secret-thread", "secret-agent"));
  const seedContents = webContents.getAllWebContents().find((contents) => contents.getURL() === seed.url);
  if (!seedContents) throw new Error("Missing authentication fixture session.");
  const protocol = seedContents.session.protocol;
  let mirroredPageLoads = 0;
  let modalPageLoads = 0;
  let stuckPageLoads = 0;
  let lostPageLoads = 0;
  let lostPageOffline = false;
  await protocol.handle("https", async (request) => {
    const url = new URL(request.url);
    if (url.pathname === "/frame-form" && FRAME_HOSTS.includes(url.hostname))
      return new Response(
        `<!doctype html><body>
        <label>Frame password<input id="frame-password" type="password"></label>
        <button id="frame-submit" onclick="parent.postMessage(document.querySelector('#frame-password').value === '${FRAME_PASSWORD}', 'https://authentication.openbot.test')">Frame sign in</button>
        </body>`,
        { headers: { "Content-Type": "text/html" } },
      );
    if (url.hostname !== "authentication.openbot.test") return new Response("Not found", { status: 404 });
    if (url.pathname === "/framed" || url.pathname === "/framed-other")
      return new Response(
        `<!doctype html><body>
        <iframe title="Sign in" width="400" height="200" src="https://${url.pathname === "/framed" ? FRAME_HOSTS[0] : FRAME_HOSTS[1]}/frame-form"></iframe>
        <script>addEventListener('message', (event) => { if (event.origin.startsWith('https://login.')) location.href = event.data === true ? '/complete' : '/wrong'; });</script>
        </body>`,
        { headers: { "Content-Type": "text/html" } },
      );
    if (url.pathname === "/stuck") stuckPageLoads += 1;
    if (url.pathname === "/lost") {
      lostPageLoads += 1;
      if (lostPageOffline) return Response.error();
      return new Response(`<!doctype html><body><label>Password<input id="password" type="password"></label></body>`, {
        headers: { "Content-Type": "text/html" },
      });
    }
    if (url.pathname === "/modal") {
      modalPageLoads += 1;
      return new Response(
        `<!doctype html><body>
        <dialog id="verify"><form method="dialog">
        <label>Password<input id="password" type="password" oninput="const copy = document.querySelector('#strength'); copy.dataset.value = this.value; copy.textContent = this.value; document.title = this.value"></label>
        <label>Code<input id="code" inputmode="numeric"></label>
        <span id="strength"></span>
        <button id="validate" type="button">Validate</button></form></dialog></body>`,
        { headers: { "Content-Type": "text/html" } },
      );
    }
    if (url.pathname === "/bitwarden-password") return bitwardenLoginFixture("password");
    if (url.pathname === "/bitwarden-authenticator") return bitwardenLoginFixture("authenticator");
    if (url.pathname === "/signup")
      return new Response(
        `<!doctype html><body>
        <label>Name<input id="name" type="text"></label>
        <label>Password<input id="password" type="password"></label>
        <label>Confirm password<input id="confirm" type="password"></label>
        <button id="submit" onclick="const password = document.querySelector('#password').value; if (password && password === document.querySelector('#confirm').value) location.href = '/complete'">Register</button>
        </body>`,
        { headers: { "Content-Type": "text/html" } },
      );
    if (url.pathname === "/mirrored") {
      mirroredPageLoads += 1;
      return new Response(
        `<!doctype html><body>
        <label>Password<input id="password" type="password" oninput="this.setAttribute('value', this.value)"></label>
        <button id="submit" onclick="document.querySelector('#answer').textContent = 'Wrong password'">Sign in</button>
        <p id="answer"></p></body>`,
        { headers: { "Content-Type": "text/html" } },
      );
    }
    if (url.pathname === "/confirm") return confirmLoginFixture();
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
        url.pathname === "/combined"
          ? `<label>Authenticator code<input id="combined-code" autocomplete="one-time-code" inputmode="numeric"></label>
      <button id="combined-submit" onclick="if (document.querySelector('#password').value && /^[0-9]{6}$/.test(document.querySelector('#combined-code').value)) location.href = '/complete'">Sign in with code</button>`
          : ""
      }
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
      <form><h2>Verify with Google Authenticator</h2><p>Enter the temporary code generated in your Google Authenticator app.</p><label for="okta-code">Enter code</label><input id="okta-code" name="credentials.passcode" type="text" autocomplete="off"><a href="#">Verify with something else</a></form>
      <form><h2>Verify with your email</h2><p>We sent an email to you.</p><label for="okta-second-code">Enter code</label><input id="okta-second-code" name="credentials.passcode" type="text" autocomplete="off"></form>
      <form><p>We emailed you a code.</p><label>Enter code<input id="fallback-code" type="text"></label><a href="#">Use an authenticator app instead</a></form>
      <form><label>Authentication code<input id="squarespace-code" name="code" type="text"></label></form>
      <form><input id="userid" type="number" placeholder="••••••"><label for="userid">External TOTP</label></form>
      <form><p>Open your Google Authenticator app.</p><label>Enter code<input id="answer" name="answer" type="text"></label><label>Promo code<input id="promo-code" type="text"></label></form>
      <form><script>const totpEnabled = true;</script><p hidden>Authenticator</p><label>Enter code<input id="plain-form-code" type="text"></label></form>
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
    {
      const tab = await runCauseEffect(
        browser.open("https://authentication.openbot.test/address-change", "secret-thread", "secret-agent"),
      );
      try {
        const contents = webContents.getAllWebContents().find((candidate) => candidate.getURL() === tab.url);
        if (!contents) throw new Error("Missing address change fixture.");
        await waitForPresentedFrame(contents);
        const handoff = await runCauseEffect(
          browser.prepareSecret({
            namespace: "openbot_browser",
            tool: "submit_secret",
            threadId: "secret-thread",
            ownerAgentId: "secret-agent",
            turnId: "secret-turn",
            callId: "secret-address-change",
            arguments: {
              tabId: tab.id,
              method: "password",
              targets: [{ kind: "css", selector: "#password" }],
              submission: "click",
              submitTarget: { kind: "css", selector: "#submit" },
            },
          }),
        );
        await contents.executeJavaScript(
          "history.replaceState({}, '', '/address-change?step=password'); history.pushState({}, '', '/address-change/password'); location.hash = 'password'",
        );
        const secret = "fixture-address-change-password-5531";
        if ((await runCauseEffect(handoff.submit(secret, false))) !== "submitted")
          throw new Error("A same-document address change stopped the secure password fill.");
        const snapshot = await runCauseEffect(browser.snapshot(tab.id));
        if (JSON.stringify(snapshot).includes(secret)) throw new Error("Authentication value reached a snapshot.");
        if (!snapshot.url.endsWith("/complete")) throw new Error("The address change fixture did not complete.");
      } finally {
        await runCauseEffect(browser.close(tab.id));
      }
    }
    const combinedPassword = "fixture-combined-password-418";
    const combinedCode = "604213";
    {
      const tab = await runCauseEffect(
        browser.open("https://authentication.openbot.test/combined", "secret-thread", "secret-agent"),
      );
      try {
        const contents = webContents.getAllWebContents().find((candidate) => candidate.getURL() === tab.url);
        if (!contents) throw new Error("Missing combined sign-in fixture.");
        await waitForPresentedFrame(contents);
        const params = ({ saved = true, codeSelector = "#combined-code" } = {}): DynamicToolCallParams => ({
          namespace: "openbot_browser",
          tool: "submit_secret",
          threadId: "secret-thread",
          ownerAgentId: "secret-agent",
          turnId: "secret-turn",
          callId: "secret-combined",
          arguments: {
            tabId: tab.id,
            method: "password",
            ...(saved ? { loginId: "combined-login" } : {}),
            targets: [
              { kind: "css", selector: "#password" },
              { kind: "css", selector: codeSelector },
            ],
            digits: 6,
            submission: "click",
            submitTarget: { kind: "css", selector: "#combined-submit" },
          },
        });
        const refused = await runCauseEffect(browser.prepareSecret(params({ saved: false }))).then(
          () => false,
          () => true,
        );
        if (!refused) throw new Error("Password and code targets were accepted without a saved login.");
        const wrongField = await runCauseEffect(browser.prepareSecret(params({ codeSelector: "#code" })));
        wrongField.cancel();
        if (wrongField.vaultFillable || !wrongField.withCode)
          throw new Error("A field that does not ask for a code was classified as a code field.");
        const handoff = await runCauseEffect(browser.prepareSecret(params()));
        if (!handoff.vaultFillable || !handoff.withCode)
          throw new Error("The password and code fields were classified wrongly for a vault fill.");
        if ((await runCauseEffect(handoff.submit(combinedPassword, true, combinedCode))) !== "submitted")
          throw new Error("The combined sign-in did not go on: a field was empty at the submit.");
        const snapshot = await runCauseEffect(browser.snapshot(tab.id));
        if ([combinedPassword, combinedCode].some((value) => JSON.stringify(snapshot).includes(value)))
          throw new Error("A combined sign-in value reached a snapshot.");
        if (!snapshot.url.endsWith("/complete")) throw new Error("Combined sign-in fixture did not complete.");
      } finally {
        await runCauseEffect(browser.close(tab.id));
      }
    }
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
    for (const [selector, fillable] of [
      ["#otp", true],
      ["#totpmfa", true],
      ["#okta-code", true],
      ["#okta-second-code", false],
      ["#fallback-code", false],
      ["#squarespace-code", true],
      ["#userid", true],
      ["#answer", true],
      ["#promo-code", false],
      ["#plain-form-code", false],
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
    let vaultFillable = false;
    const signup: Array<{ confirm: string; result: string; path: string }> = [];
    for (const [confirm, expected] of [
      ["#confirm", "submitted"],
      ["#name", "must both be password fields"],
    ] as const) {
      const signupTab = await runCauseEffect(
        browser.open("https://authentication.openbot.test/signup", "secret-thread", "secret-agent"),
      );
      try {
        const signupContents = webContents.getAllWebContents().find((item) => item.getURL() === signupTab.url);
        if (!signupContents) throw new Error("Missing sign-up fixture.");
        await waitForPresentedFrame(signupContents);
        const result = await runCauseEffect(
          browser.prepareSecret({
            namespace: "openbot_browser",
            tool: "submit_secret",
            threadId: "secret-thread",
            ownerAgentId: "secret-agent",
            turnId: "secret-turn",
            callId: `signup-${confirm}`,
            arguments: {
              tabId: signupTab.id,
              method: "password",
              targets: [
                { kind: "css", selector: "#password" },
                { kind: "css", selector: confirm },
              ],
              submission: "click",
              submitTarget: { kind: "css", selector: "#submit" },
            },
          }),
        ).then(
          async (handoff) => {
            vaultFillable ||= handoff.vaultFillable;
            return runCauseEffect(handoff.submit(vaultPassword, true));
          },
          (error: unknown) => (error instanceof Error ? error.message : String(error)),
        );
        const snapshot = await runCauseEffect(browser.snapshot(signupTab.id));
        signup.push({ confirm, result, path: new URL(snapshot.url).pathname });
        if (!result.includes(expected) || (expected === "submitted") !== snapshot.url.endsWith("/complete"))
          throw new Error(`A sign-up fill with ${confirm} gave ${result} at ${snapshot.url}.`);
        if (JSON.stringify(snapshot).includes(vaultPassword)) throw new Error("A sign-up password reached a snapshot.");
      } finally {
        await runCauseEffect(browser.close(signupTab.id));
      }
    }
    if (!vaultFillable) throw new Error("A sign-up password and confirmation were not vault-fillable.");
    await mkdir(".openbot-build", { recursive: true });
    await writeFile(
      ".openbot-build/browser-secret-confirm-password.json",
      JSON.stringify({ status: "passed", vaultFillable, signup }, null, 2),
    );
    const mirroredTab = await runCauseEffect(
      browser.open("https://authentication.openbot.test/mirrored", "secret-thread", "secret-agent"),
    );
    try {
      const mirroredContents = webContents.getAllWebContents().find((item) => item.getURL() === mirroredTab.url);
      if (!mirroredContents) throw new Error("Missing mirrored value fixture.");
      await waitForPresentedFrame(mirroredContents);
      const handoff = await runCauseEffect(
        browser.prepareSecret({
          namespace: "openbot_browser",
          tool: "submit_secret",
          threadId: "secret-thread",
          ownerAgentId: "secret-agent",
          turnId: "secret-turn",
          callId: "mirrored-value",
          arguments: {
            tabId: mirroredTab.id,
            method: "password",
            targets: [{ kind: "css", selector: "#password" }],
            submission: "click",
            submitTarget: { kind: "css", selector: "#submit" },
          },
        }),
      );
      const secret = "fixture-password-385617";
      const submission = await runCauseEffect(handoff.submit(secret, false));
      const page = z
        .object({ answer: z.string(), value: z.string(), attribute: z.string().nullable() })
        .parse(
          await mirroredContents.executeJavaScript(
            "({ answer: document.querySelector('#answer').textContent, value: document.querySelector('#password').value, attribute: document.querySelector('#password').getAttribute('value') })",
            true,
          ),
        );
      const snapshot = JSON.stringify(await runCauseEffect(browser.snapshot(mirroredTab.id)));
      const report = {
        status:
          submission === "submitted" &&
          mirroredPageLoads === 1 &&
          page.answer === "Wrong password" &&
          page.value === "" &&
          !page.attribute &&
          !snapshot.includes(secret)
            ? "passed"
            : "issues_found",
        submission,
        pageLoads: mirroredPageLoads,
        answerKept: page.answer === "Wrong password",
        fieldEmpty: page.value === "" && !page.attribute,
        snapshotHasValue: snapshot.includes(secret),
      };
      await mkdir(".openbot-build", { recursive: true });
      await writeFile(".openbot-build/browser-secret-mirrored-value.json", JSON.stringify(report, null, 2));
      if (report.status !== "passed")
        throw new Error(`A same-document sign-in lost its answer: ${JSON.stringify(report)}`);
    } finally {
      await runCauseEffect(browser.close(mirroredTab.id));
    }
    const modalTab = await runCauseEffect(
      browser.open("https://authentication.openbot.test/modal", "secret-thread", "secret-agent"),
    );
    try {
      const modalContents = webContents.getAllWebContents().find((item) => item.getURL() === modalTab.url);
      if (!modalContents) throw new Error("Missing dialog fixture.");
      await waitForPresentedFrame(modalContents);
      await modalContents.executeJavaScript(
        "document.querySelector('#verify').showModal(); document.querySelector('#code').value = '482913';",
        true,
      );
      const handoff = await runCauseEffect(
        browser.prepareSecret({
          namespace: "openbot_browser",
          tool: "submit_secret",
          threadId: "secret-thread",
          ownerAgentId: "secret-agent",
          turnId: "secret-turn",
          callId: "dialog-value",
          arguments: {
            tabId: modalTab.id,
            method: "password",
            targets: [{ kind: "css", selector: "#password" }],
            submission: "on_input",
          },
        }),
      );
      const secret = "fixture-password-964301";
      const submission = await runCauseEffect(handoff.submit(secret, false));
      const page = z
        .object({ open: z.boolean(), code: z.string(), copy: z.string().optional() })
        .parse(
          await modalContents.executeJavaScript(
            "({ open: document.querySelector('#verify').open, code: document.querySelector('#code').value, copy: document.querySelector('#strength').dataset.value })",
            true,
          ),
        );
      const read = await runCauseEffect(browser.snapshot(modalTab.id));
      const snapshot = JSON.stringify(read);
      const listed = JSON.stringify(browser.listTabs().find((tab) => tab.id === modalTab.id));
      const tool = (name: string, args: DynamicToolCallParams["arguments"]) =>
        runCauseEffect(
          browser.handleDynamicTool({
            namespace: "openbot_browser",
            tool: name,
            threadId: "secret-thread",
            ownerAgentId: "secret-agent",
            turnId: "secret-turn",
            callId: `dialog-${name}`,
            arguments: args,
          }),
        ).then(
          (result) => result.success,
          () => false,
        );
      const partialWaitRefused = !(await tool("wait_for", {
        tabId: modalTab.id,
        text: secret.slice(0, 4),
        timeoutMs: 1_000,
      }));
      const cssTargetRefused = !(await tool("click", {
        tabId: modalTab.id,
        target: { kind: "css", selector: `[data-value^="${secret.slice(0, 4)}"]` },
      }));
      const validate = read.elements.find((element) => element.name === "Validate");
      const refClickWorks =
        validate !== undefined &&
        (await tool("click", {
          tabId: modalTab.id,
          target: { kind: "ref", ref: validate.ref, revision: read.revision },
        }));
      const screenshotRefused = await runCauseEffect(browser.screenshot(modalTab.id)).then(
        () => false,
        () => true,
      );
      const report = {
        status:
          submission === "submitted" &&
          modalPageLoads === 1 &&
          page.open &&
          page.code === "482913" &&
          page.copy === secret &&
          !snapshot.includes(secret) &&
          !listed.includes(secret) &&
          screenshotRefused &&
          partialWaitRefused &&
          cssTargetRefused &&
          refClickWorks
            ? "passed"
            : "issues_found",
        submission,
        pageLoads: modalPageLoads,
        dialogOpen: page.open,
        codeKept: page.code === "482913",
        pageKeepsCopy: page.copy === secret,
        snapshotHasValue: snapshot.includes(secret),
        tabListHasValue: listed.includes(secret),
        screenshotRefused,
        partialWaitRefused,
        cssTargetRefused,
        refClickWorks,
      };
      await mkdir(".openbot-build", { recursive: true });
      await writeFile(".openbot-build/browser-secret-dialog.json", JSON.stringify(report, null, 2));
      if (report.status !== "passed")
        throw new Error(`A password fill in a dialog lost the dialog or showed the value: ${JSON.stringify(report)}`);
    } finally {
      await runCauseEffect(browser.close(modalTab.id));
    }
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
      const loadsBefore = stuckPageLoads;
      const submission = await runCauseEffect(handoff.submit(secret, false)).catch(() => "failed" as const);
      const keptAfterSubmit = stuckPageLoads === loadsBefore;
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
          submission === "submitted" && keptAfterSubmit && refused && frames > 0 && !page.includes(secret)
            ? "passed"
            : "issues_found",
        submission,
        keptAfterSubmit,
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
    const lostResults: Record<string, { passed: boolean; [detail: string]: boolean | number | string }> = {};
    for (const ending of ["after-fill", "during-fill"] as const) {
      lostPageOffline = false;
      const lostTab = await runCauseEffect(
        browser.open("https://authentication.openbot.test/lost", "secret-thread", "secret-agent"),
      );
      try {
        const lostContents = webContents.getAllWebContents().find((item) => item.getURL() === lostTab.url);
        if (!lostContents) throw new Error("Missing failed fill fixture.");
        const handoff = await runCauseEffect(
          browser.prepareSecret({
            namespace: "openbot_browser",
            tool: "submit_secret",
            threadId: "secret-thread",
            ownerAgentId: "secret-agent",
            turnId: "secret-turn",
            callId: `lost-${ending}`,
            arguments: {
              tabId: lostTab.id,
              method: "password",
              targets: [{ kind: "css", selector: "#password" }],
              submission: "on_input",
            },
          }),
        );
        await lostContents.executeJavaScript("document.querySelector('#password').id = 'rendered-again'", true);
        const loadsBefore = lostPageLoads;
        const title = () => browser.listTabs().find((tab) => tab.id === lostTab.id)?.title;
        let protectedAfterFill = false;
        if (ending === "after-fill") {
          await runCauseEffect(handoff.submit("fixture-password-118204", true)).catch(() => undefined);
          protectedAfterFill = title() === "Secure authentication";
          lostPageOffline = true;
          await runCauseEffect(browser.beginTakeover(lostTab.id));
          browser.endTakeover(lostTab.id);
        } else {
          const fill = runCauseEffect(handoff.submit("fixture-password-118204", true)).catch(() => undefined);
          browser.endTakeover(lostTab.id);
          await fill;
          protectedAfterFill = true;
        }
        const deadline = Date.now() + 15_000;
        while (title() === "Secure authentication" && Date.now() < deadline)
          await new Promise((resolve) => setTimeout(resolve, 50));
        const released = title() !== "Secure authentication";
        const snapshotWorks = await runCauseEffect(browser.snapshot(lostTab.id)).then(
          () => true,
          () => false,
        );
        const closed = await runCauseEffect(
          browser.handleDynamicTool({
            namespace: "openbot_browser",
            tool: "close_tab",
            threadId: "secret-thread",
            ownerAgentId: "secret-agent",
            turnId: "secret-turn",
            callId: `lost-close-${ending}`,
            arguments: { tabId: lostTab.id },
          }),
        ).then(
          (result) =>
            result.success || result.contentItems.map((item) => (item.type === "inputText" ? item.text : "")).join(" "),
          (error: unknown) => (error instanceof Error ? error.message : String(error)),
        );
        lostResults[ending] = {
          passed: protectedAfterFill && released && snapshotWorks && closed === true,
          protectedAfterFill,
          reloadAttempts: lostPageLoads - loadsBefore,
          released,
          snapshotWorks,
          closed,
        };
      } finally {
        await runCauseEffect(browser.close(lostTab.id));
      }
    }
    lostPageOffline = false;
    const heldTab = await runCauseEffect(
      browser.open("https://authentication.openbot.test/lost", "secret-thread", "secret-agent"),
    );
    try {
      const heldContents = webContents.getAllWebContents().find((item) => item.getURL() === heldTab.url);
      if (!heldContents) throw new Error("Missing failed fill fixture.");
      const handoff = await runCauseEffect(
        browser.prepareSecret({
          namespace: "openbot_browser",
          tool: "submit_secret",
          threadId: "secret-thread",
          ownerAgentId: "secret-agent",
          turnId: "secret-turn",
          callId: "held-fill",
          arguments: {
            tabId: heldTab.id,
            method: "password",
            targets: [{ kind: "css", selector: "#password" }],
            submission: "on_input",
          },
        }),
      );
      const tool = (name: string, args: DynamicToolCallParams["arguments"]) =>
        runCauseEffect(
          browser.handleDynamicTool({
            namespace: "openbot_browser",
            tool: name,
            threadId: "secret-thread",
            ownerAgentId: "secret-agent",
            turnId: "secret-turn",
            callId: `held-${name}`,
            arguments: args,
          }),
        ).then(
          (result) =>
            result.success || result.contentItems.map((item) => (item.type === "inputText" ? item.text : "")).join(" "),
          (error: unknown) => (error instanceof Error ? error.message : String(error)),
        );
      const protectedError = (result: unknown) =>
        typeof result === "string" && result.includes("protected during authentication");
      const closeWithCardRefused = protectedError(await tool("close_tab", { tabId: heldTab.id }));
      await heldContents.executeJavaScript("document.querySelector('#password').id = 'rendered-again'", true);
      await runCauseEffect(handoff.submit("fixture-password-118204", true)).catch(() => undefined);
      const held = browser.listTabs().find((tab) => tab.id === heldTab.id)?.title === "Secure authentication";
      const snapshotRefused = protectedError(await tool("snapshot", { tabId: heldTab.id }));
      const navigateRefused = protectedError(await tool("navigate", { tabId: heldTab.id, direction: "reload" }));
      const closed = await tool("close_tab", { tabId: heldTab.id });
      lostResults.held = {
        passed:
          held &&
          closeWithCardRefused &&
          snapshotRefused &&
          navigateRefused &&
          closed === true &&
          !browser.listTabs().some((tab) => tab.id === heldTab.id),
        held,
        closeWithCardRefused,
        snapshotRefused,
        navigateRefused,
        closed,
      };
    } finally {
      await runCauseEffect(browser.close(heldTab.id));
    }
    const lostReport = {
      status: Object.values(lostResults).every((result) => result.passed) ? "passed" : "issues_found",
      ...lostResults,
    };
    await mkdir(".openbot-build", { recursive: true });
    await writeFile(".openbot-build/browser-secret-ended-fill.json", JSON.stringify(lostReport, null, 2));
    if (lostReport.status !== "passed")
      throw new Error(`A tab stayed locked after its saved login ended: ${JSON.stringify(lostReport)}`);
    await runFrameScenario(browser);
    process.stdout.write("BrowserHost: secure password, OTP and authenticator handoff passed.\n");
  } finally {
    protocol.unhandle("https");
  }
}

const CONFIRM_PASSWORD = "fixture confirm+password/381904";

interface ResubmitStep {
  name: string;
  secretInSnapshot: boolean;
  evaluateBlocked: boolean;
  screenshotBlocked: boolean;
  page: string;
  field: "empty" | "filled" | null;
  secretInAnyAddress: boolean;
}

function confirmLoginFixture(): Response {
  const send = (method: string, target: string) =>
    `const form = document.querySelector('#form'); form.method = '${method}'; form.target = '${target}'; form.submit()`;
  return new Response(
    `<!doctype html><body>
    <form id="form" method="post" action="/confirmed">
      <label>Password<input id="password" name="password" type="password"></label>
      <button type="button" id="sign-in" onclick="document.querySelector('#question').hidden = false">Sign in</button>
      <div id="question" hidden>User logged in on another device. Continue?
        <button type="button" id="yes" onclick="${send("post", "")}">Yes</button>
        <button type="button" id="yes-get" onclick="${send("get", "")}">Yes as GET</button>
        <button type="button" id="yes-popup" onclick="${send("get", "_blank")}">Yes in a new window</button></div>
    </form>
    <label>Show password<input id="show" type="checkbox" onchange="document.querySelector('#password').type = this.checked ? 'text' : 'password'"></label>
    <button type="button" id="copy" onclick="const copy = document.createElement('input'); copy.value = document.querySelector('#password').value; document.body.append(copy)">Copy</button>
    </body>`,
    { headers: { "Content-Type": "text/html" } },
  );
}

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
  const steps: ResubmitStep[] = [];
  for (const [flow, actions] of [
    ["resubmit", ["yes-get", "yes-popup", "yes"]],
    ["reveal", ["copy", "show"]],
  ] as const) {
    const tab = await runCauseEffect(
      browser.open("https://authentication.openbot.test/confirm", "secret-thread", "secret-agent"),
    );
    try {
      const contents = webContents.getAllWebContents().find((item) => item.getURL() === tab.url);
      if (!contents) throw new Error("Missing confirm fixture.");
      await waitForPresentedFrame(contents);
      const handoff = await runCauseEffect(
        browser.prepareSecret({
          namespace: "openbot_browser",
          tool: "submit_secret",
          threadId: "secret-thread",
          ownerAgentId: "secret-agent",
          turnId: "secret-turn",
          callId: `resubmit-${flow}`,
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
      const kept = await contents.executeJavaScript(
        `document.querySelector('#password').value === ${JSON.stringify(CONFIRM_PASSWORD)}`,
      );
      if (submission !== "submitted" || kept !== true)
        throw new Error(`The ${flow} sign-in did not keep the password: ${submission}, kept ${String(kept)}.`);
      const observe = async (name: string): Promise<ResubmitStep> => {
        const snapshot = await runCauseEffect(browser.snapshot(tab.id));
        const evaluation = await call("evaluate", { tabId: tab.id, expression: "document.title" });
        const screenshot = await call("screenshot", { tabId: tab.id });
        const confirmed = new URL(contents.getURL()).pathname === "/confirmed";
        const field = confirmed ? null : await contents.executeJavaScript("document.querySelector('#password').value");
        const step: ResubmitStep = {
          name: `${flow} ${name}`,
          secretInSnapshot: JSON.stringify(snapshot).includes(CONFIRM_PASSWORD),
          evaluateBlocked: !evaluation.success,
          screenshotBlocked: !screenshot.success,
          page: snapshot.text.includes("Signed in")
            ? "signed-in"
            : snapshot.text.includes("Password cannot be blank")
              ? "blank-password"
              : new URL(snapshot.url).pathname,
          field: field === null ? null : field === "" ? "empty" : "filled",
          secretInAnyAddress: webContents.getAllWebContents().some((item) => item.getURL().includes("381904")),
        };
        steps.push(step);
        return step;
      };
      const expected: Record<string, (step: ResubmitStep) => boolean> = {
        submit: (step) => step.page === "/confirm" && step.field === "filled" && step.evaluateBlocked,
        "yes-get": (step) => step.page === "/confirm" && step.field === "filled",
        "yes-popup": (step) => step.page === "/confirm" && step.field === "filled",
        yes: (step) => step.page === "signed-in",
        copy: (step) => step.page === "/confirm" && step.screenshotBlocked,
        show: (step) => step.page === "/confirm" && step.field === "empty",
      };
      for (const action of ["submit", ...actions]) {
        if (action !== "submit") {
          const loaded =
            action === "yes"
              ? new Promise<void>((resolve, reject) => {
                  const timer = setTimeout(() => reject(new Error("The confirmed sign-in did not load.")), 10_000);
                  contents.once("did-finish-load", () => {
                    clearTimeout(timer);
                    resolve();
                  });
                })
              : Promise.resolve();
          await call("click", { tabId: tab.id, target: { kind: "css", selector: `#${action}` } });
          await loaded;
        }
        const step = await observe(action);
        const screenshotExpected = flow === "reveal" && action !== "submit";
        if (
          !expected[action]?.(step) ||
          step.secretInSnapshot ||
          step.secretInAnyAddress ||
          step.screenshotBlocked !== screenshotExpected
        )
          throw new Error(`A kept password failed at ${step.name}: ${JSON.stringify(step)}`);
      }
    } finally {
      await runCauseEffect(browser.close(tab.id));
    }
  }
  await mkdir(".openbot-build", { recursive: true });
  await writeFile(".openbot-build/browser-secret-resubmit.json", JSON.stringify({ status: "passed", steps }, null, 2));
}
