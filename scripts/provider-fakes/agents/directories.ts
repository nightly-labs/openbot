// The agents of `acp-additional-directories-e2e.ts`. `FAKE_MODE` picks one: "strict-resume" and
// "strict-load" refuse `additionalDirectories` as Grok 1.0.60 does and resume with `session/resume`
// or `session/load`; "wide" advertises the field and takes it.
import { type AcpHandler, logEntry, serveFakeAcpAgent } from "../acp-agent";

const mode = process.env.FAKE_MODE;
let sessions = 0;

const session: AcpHandler = (request, peer) => {
  const directories = request.params.additionalDirectories;
  logEntry({ method: request.method, cwd: request.params.cwd, additionalDirectories: directories ?? null });
  // Grok 1.0.60's answer to a field it does not advertise.
  if (mode !== "wide" && directories?.length) {
    peer.fail(request, {
      code: -32602,
      message: "Invalid params",
      data: "additionalDirectories is not supported: a session works only in its cwd",
    });
    return;
  }
  if (request.method === "session/new") {
    sessions += 1;
    peer.reply(request, { sessionId: `s-${sessions}` });
  } else {
    peer.reply(request, {});
  }
};

serveFakeAcpAgent({
  initialize: (request, peer) => {
    const sessionCapabilities =
      mode === "strict-resume" ? { resume: {} } : mode === "wide" ? { resume: {}, additionalDirectories: {} } : {};
    peer.reply(request, {
      protocolVersion: 1,
      agentInfo: { name: "fake", title: mode, version: "1.0.0" },
      agentCapabilities: { loadSession: true, sessionCapabilities },
    });
  },
  "session/new": session,
  "session/load": session,
  "session/resume": session,
  "session/prompt": (request, peer) => {
    peer.say(request.params.sessionId, "OK");
    peer.reply(request, { stopReason: "end_turn" });
  },
});
