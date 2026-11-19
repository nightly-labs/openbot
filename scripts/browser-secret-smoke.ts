import { mkdir, writeFile } from "node:fs/promises";
import { webContents } from "electron";
import { z } from "zod";
import type { BrowserHost } from "../src/backend/browser-host";
import { runCauseEffect } from "../src/backend/effect-boundary";
import type { DynamicToolCallParams } from "../src/backend/protocol";
import { bitwardenLoginFixture, runBitwardenBrowserSmoke } from "./bitwarden-browser-smoke";
import { waitForPresentedFrame } from "./browser-smoke-frames";

/** The first frame host is on the page's site, the second is on another site. */
const FRAME_HOSTS = ["login.openbot.test", "login.other-site.test"];
const FRAME_PASSWORD = "fixture-frame-password-201938";

/**
 * A secure fill reaches a sign-in form in a frame of the page's site, with the vault origin of the
 * frame. A form in a frame of another site is refused (#10018, #10148).
 */
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
      // The frame loads after the page. Wait until the snapshot shows its fields.
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

/** HTTPS is served inside this isolated session. No credentials or network service are used. */
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
      // A sign-in form in a frame, as Apple's (#10018). The page goes on only when the frame got the value.
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
      // The page cannot load again, as when the computer is offline when the card ends (#9883).
      if (lostPageOffline) return Response.error();
      return new Response(`<!doctype html><body><label>Password<input id="password" type="password"></label></body>`, {
        headers: { "Content-Type": "text/html" },
      });
    }
    if (url.pathname === "/modal") {
      modalPageLoads += 1;
      // A password step in a dialog that holds more fields (#9643). The page copies the password into
      // an attribute, its text and its title, so the value stays in the page after OpenBot empties the field.
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
      // A sign-up form: it sends only when the password and its confirmation match (#6333).
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
      // A single-page sign-in as React renders it: the field's value is copied to its value attribute,
      // and the answer shows in the same document.
      return new Response(
        `<!doctype html><body>
        <label>Password<input id="password" type="password" oninput="this.setAttribute('value', this.value)"></label>
        <button id="submit" onclick="document.querySelector('#answer').textContent = 'Wrong password'">Sign in</button>
        <p id="answer"></p></body>`,
        { headers: { "Content-Type": "text/html" } },
      );
    }
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
    // A sign-in page that sets its address while the card is open keeps its fields, so the fill still
    // goes through (#10462). Many mail sign-in pages do this for the password step.
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
    // A form that sends the password and the authenticator code in one submit gets both from one saved
    // login. The page goes on only when both fields hold a value at the click, so a fill that empties
    // the first field before the second one fails here.
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
        // A password target with code fields needs a saved login, and a field that does not ask for a
        // code is not a code field.
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
    // autocomplete="one-time-code"; Okta names it passcode, and Squarespace and Kite name it only in its
    // label (#8320). A field named only "code" or "passcode" takes it in a form whose visible text names
    // an authenticator app and no email. A recovery, SMS, phone, or promo field, an email code field, or
    // a plain code field in another form does not take it, also when hidden text names an app.
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
    // One saved password fills a sign-up form's password and its confirmation, and the form sends. A
    // text field cannot take the second copy (#6333).
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
    // A sign-in that answers in the same document keeps its answer: OpenBot empties the field and its
    // value attribute, and does not load the page again (#7564).
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
    // A page that keeps a copy of the password stays open with its dialog and its other fields
    // (#9643). Snapshots and the tab list hide the value, and no image of the tab is taken.
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
      // The page keeps a copy, so a query of its raw text could find the value one part at a time.
      // A ref from a snapshot still works.
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
    // A submission that leaves the value in the page keeps the page, and no live view shows it. The
    // live view of a takeover loads the page again, so a person on another computer can sign in by
    // hand and never sees the value.
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
    // A saved login that fails keeps the tab protected. When its card ends, by a cancel, a stop or the
    // end of a routine, the tab must be free again: also when the page cannot load again, and also
    // when the card ends while the fill still runs. Until then, the agent can still close the tab (#9883).
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
        // The page renders its field again while the saved login is read, so the fill fails.
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
    // A protected tab that nothing releases: the agent can close it, and no other tool reads it.
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
      // While the card is open, the tab stays: a close would leave the card on a tab that is gone.
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
