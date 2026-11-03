/* Browser code loaded by subscription-voice-live-e2e.ts. Audio is supplied, never recorded. */
async function _runSubscriptionVoiceProbe({ waves, agentId, expectedName, historyCanary }) {
  const api = window.openbot;
  const status = await api.voice.getRealtimeStatus("local");
  if (!status.enabled || status.model !== "gpt-live-1-codex")
    throw new Error("Enable subscription voice on the named local test host first.");
  const { createRealtimeVoiceConversation } = await import("/src/features/conversation/realtime-voice-conversation.ts");
  const replies = await import("/src/features/speech/speech-replies.ts");
  const context = new AudioContext();
  await context.resume();
  const destination = context.createMediaStreamDestination();
  // Keep silent audio frames flowing, as an open microphone does before the caller speaks.
  const silence = context.createConstantSource();
  silence.offset.value = 0;
  silence.connect(destination);
  silence.start();
  const originalMedia = navigator.mediaDevices.getUserMedia;
  const OriginalAudio = window.Audio;
  const originalChannel = RTCPeerConnection.prototype.createDataChannel;
  const events = [];
  const peers = [];
  const eventTypes = {};
  const failures = [];
  let delegated = 0;
  RTCPeerConnection.prototype.createDataChannel = function (...args) {
    peers.push(this);
    this.addEventListener("connectionstatechange", () => {
      if (["failed", "disconnected", "closed"].includes(this.connectionState)) failures.push(this.connectionState);
    });
    const channel = originalChannel.apply(this, args);
    channel.addEventListener("message", (message) => {
      try {
        const event = JSON.parse(message.data);
        eventTypes[event.type] = (eventTypes[event.type] ?? 0) + 1;
        if (event.type === "error" || event.type === "session.closed")
          failures.push({ type: event.type, code: event.error?.code });
        if (event.type === "turn.done" && event.turn && typeof event.turn.transcript === "string")
          events.push({ role: event.turn.role, text: event.turn.transcript });
      } catch {}
    });
    return channel;
  };
  navigator.mediaDevices.getUserMedia = async () => destination.stream;
  window.Audio = class extends OriginalAudio {
    constructor(...args) {
      super(...args);
      this.muted = true;
    }
    play() {
      return super.play().catch((error) => {
        failures.push({ playback: error.name });
        throw error;
      });
    }
  };
  const call = createRealtimeVoiceConversation({
    agentId,
    serverId: "local",
    voice: api.voice,
    serverOnline: () => true,
    submit: async (draft, target, _snapshot, voice) => {
      delegated++;
      const acknowledge = replies.claimDictatedSend(target);
      try {
        const receipt = await api.agent.sendMessage({ agentId: target.agentId, text: draft.text }, target.serverId);
        const delivery = receipt.deliveries[0];
        if (!delivery) {
          voice.onFailed();
          return false;
        }
        acknowledge?.(delivery.id);
        return true;
      } catch {
        voice.onFailed();
        return false;
      }
    },
  });
  const wait = async (test, timeout = 20000) => {
    const until = performance.now() + timeout;
    while (!test()) {
      if (call.error()) throw new Error(call.error());
      if (performance.now() > until) throw new Error("Voice turn did not complete");
      await new Promise((r) => setTimeout(r, 50));
    }
  };
  const sources = [];
  const answers = [];
  let startup;
  const assistantText = (start = 0) =>
    events
      .slice(start)
      .filter((e) => e.role === "assistant")
      .map((e) => e.text)
      .join(" ");
  const identifiesAsChatGPT = (text) => /I['’]m ChatGPT|I am ChatGPT/i.test(text);
  const identifiesAsAgent = (text) => text.toLowerCase().includes(expectedName.toLowerCase());
  try {
    await call.start();
    navigator.mediaDevices.getUserMedia = originalMedia;
    window.Audio = OriginalAudio;
    if (call.error()) throw new Error(call.error());
    await wait(() => identifiesAsAgent(assistantText()) && call.phase() === "listening");
    const greeting = assistantText();
    startup = {
      greeted: /\b(hello|hi|hey|good morning|good afternoon|good evening)\b/i.test(greeting),
      selectedAgent: identifiesAsAgent(greeting) && !identifiesAsChatGPT(greeting),
      historyReplayed: Boolean(historyCanary && greeting.toLowerCase().includes(historyCanary.toLowerCase())),
      delegated,
    };
    for (const wave of waves) {
      const source = context.createBufferSource();
      sources.push(source);
      source.buffer = await context.decodeAudioData(Uint8Array.from(atob(wave), (c) => c.charCodeAt(0)).buffer);
      source.connect(destination);
      const start = events.length;
      const ended = new Promise((resolve) => {
        source.onended = resolve;
      });
      source.start();
      await ended;
      await wait(() => {
        const user = events.findIndex((e, i) => i >= start && e.role === "user");
        const text = assistantText(start);
        return user >= 0 && (identifiesAsAgent(text) || identifiesAsChatGPT(text)) && call.phase() === "listening";
      });
      const text = assistantText(start);
      answers.push({
        userTurnCaptured: true,
        selectedAgent: identifiesAsAgent(text),
        chatGPTSelf: identifiesAsChatGPT(text),
      });
      await wait(() => call.phase() === "listening", 15000);
    }
    return { startup, answers, delegated, phase: call.phase(), audioFixtureCount: waves.length };
  } catch (error) {
    return {
      error: String(error),
      startup,
      answers,
      delegated,
      eventCount: events.length,
      eventRoles: events.map((e) => e.role),
      eventTypes,
      failures,
      stats: peers[0]
        ? Array.from((await peers[0].getStats()).values())
            .filter((s) => s.type === "outbound-rtp" || s.type === "media-source")
            .map((s) => ({
              type: s.type,
              kind: s.kind,
              packetsSent: s.packetsSent,
              bytesSent: s.bytesSent,
              audioLevel: s.audioLevel,
              totalAudioEnergy: s.totalAudioEnergy,
              totalSamplesDuration: s.totalSamplesDuration,
            }))
        : [],
      audioContext: context.state,
      tracks: destination.stream.getTracks().map((t) => ({ enabled: t.enabled, muted: t.muted, state: t.readyState })),
      phase: call.phase(),
    };
  } finally {
    navigator.mediaDevices.getUserMedia = originalMedia;
    window.Audio = OriginalAudio;
    RTCPeerConnection.prototype.createDataChannel = originalChannel;
    call.dispose();
    for (const source of sources) {
      try {
        source.stop();
      } catch {}
    }
    silence.stop();
    await context.close();
  }
}
