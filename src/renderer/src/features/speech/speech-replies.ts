import {
  type AgentEvent,
  type ConversationMessage,
  latestTurnAnswer,
  type SpeechLanguage,
} from "@openbot/contracts/ipc";
import { speechLanguageOf } from "@openbot/contracts/speech-language";
import { speechTextFromMarkdown } from "@openbot/contracts/speech-text";
import { toast } from "@openbot/ui";
import { currentText } from "@openbot/ui/text";
import { desktopAnalytics } from "../../analytics";
import {
  loadRecording,
  pauseSpeech,
  playRecording,
  playSpokenReply,
  readAloud,
  recordingSummary,
  resumeSpeech,
  type SpeechSource,
  seekSpeech,
  speechReading,
  stopSpeech,
  type VoiceRecordingSummary,
} from "./speech-playback";
import { speechPort } from "./speech-port";
import { loadSpeechSpeed } from "./speech-speed";
import { voiceServer } from "./voice-server";

/** A dictated message that is not sent within this time does not make its reply spoken. */
const DICTATION_LIFETIME_MS = 10 * 60_000;
/** Enough messages to hold the last answer of a turn that wrote commentary and tool output after it. */
const ANSWER_LOOKUP_LIMIT = 50;

interface DictatedMessage {
  dictatedAt: number;
  /** The language of the dictation, for a reply whose own words do not show one. */
  language: SpeechLanguage;
  /** The user turn that delivers the message, once it starts or the message steers a running one. */
  turnId: string | undefined;
  /** The send that carries the message started. */
  sending: boolean;
  /** The id that the host gave the message, once the send returns. */
  messageId: string | undefined;
  /** The turns that took this agent's messages, by message id, from its queue. A steered message starts no turn. */
  deliveryTurns: Map<string, string>;
  /** The turn that ended while the request continues. The queue shows it until the next turn starts. */
  continuedTurnId: string | undefined;
  /** A voice conversation reads its replies also when the setting is off. */
  always: boolean;
  /** Whether a step of the reply is a progress update: text that the agent writes to the user while it works. */
  progressUpdate: ((message: ConversationMessage) => boolean) | undefined;
}

/** What started a reading: a voice conversation, its progress updates, a dictated message, or the Read aloud control. */
type SpeechTrigger = "voice_conversation" | "progress_update" | "dictation" | "read_aloud";

/** An agent on one server. Agent ids repeat across servers. */
export type SpeechAgent = Pick<SpeechSource, "serverId" | "agentId">;

function agentKey(agent: SpeechAgent): string {
  return `${agent.serverId}\n${agent.agentId}`;
}

/** The newest dictated message of each agent, by `agentKey`. */
const dictated = new Map<string, DictatedMessage>();
/** The reply that is read aloud now. */
let spoken: SpeechAgent | undefined;
/** The replies whose answer loads now. Dropping one before it loads keeps it from being read. */
const loading = new Set<SpeechAgent>();
/** Told when the reply to a dictated message was read, was not read, or will not come. */
const replyEndListeners = new Set<(agent: SpeechAgent) => void>();
/** The readings of replies, in order: the progress updates of a turn come before its answer. */
let readings: Promise<void> = Promise.resolve();
/** Changes when the user stops the readings, so the readings that wait are not read. */
let readingsGeneration = 0;
/**
 * The progress updates read aloud in the newest turn of each agent, by `agentKey`. It outlives the
 * dictated message: words that steer the running turn do not read its earlier updates again.
 */
const readUpdates = new Map<string, { turnId: string; ids: Set<string> }>();

/** Starts `read` when the readings before it end, unless the user stops the readings first. */
function afterReadings(read: () => Promise<void>): Promise<void> {
  const own = readingsGeneration;
  const next = readings.then(() => (own === readingsGeneration ? read() : undefined));
  readings = next.catch(() => undefined);
  return next;
}

function isSpoken(agent: SpeechAgent): boolean {
  return spoken?.serverId === agent.serverId && spoken.agentId === agent.agentId;
}

/**
 * Records that the next message the user sends to this agent was dictated, so its reply is read
 * aloud when the setting is on, or always for a voice conversation. Call it before the message is
 * sent: its turn can start first.
 */
export function noteDictatedMessage(
  agent: SpeechAgent,
  transcript: string,
  options?: { always: boolean; progressUpdate?: (message: ConversationMessage) => boolean },
): void {
  const key = agentKey(agent);
  dictated.set(key, {
    dictatedAt: Date.now(),
    language: speechLanguageOf(transcript, "en") ?? "en",
    turnId: undefined,
    sending: false,
    messageId: undefined,
    deliveryTurns: new Map(),
    continuedTurnId: undefined,
    always: options?.always ?? false,
    progressUpdate: options?.progressUpdate,
  });
  void warmSpeech(options?.always ?? false);
}

/** Loads the voice while the agent writes its reply, so the reading does not wait for it. */
async function warmSpeech(always: boolean): Promise<void> {
  const voice = speechPort().voice;
  try {
    if (!always && !(await voice.getSpeechSettings()).readReplies) return;
    await voice.warmSpeech();
  } catch {
    // The reading reports its own failure; a warm-up that fails changes nothing for the user.
  }
}

/**
 * Call when a send to this agent starts. When it carries the dictated message, returns the call that
 * takes the id the host gave the message, so a message that steers the running turn finds its turn.
 */
export function claimDictatedSend(agent: SpeechAgent): ((messageId: string) => void) | undefined {
  const message = dictated.get(agentKey(agent));
  if (!message || message.sending) return undefined;
  message.sending = true;
  return (messageId) => {
    message.messageId = messageId;
    takeDeliveryTurn(message);
  };
}

function takeDeliveryTurn(message: DictatedMessage): void {
  if (!message.turnId && message.messageId) message.turnId = message.deliveryTurns.get(message.messageId);
}

/** The dictated message was not sent. */
export function forgetDictatedMessage(agent: SpeechAgent): void {
  const key = agentKey(agent);
  if (!dictated.get(key)?.turnId) dictated.delete(key);
}

/** The reply to the dictated message of this agent is not read, also when its turn started. */
export function dropDictatedReply(agent: SpeechAgent): void {
  const key = agentKey(agent);
  dictated.delete(key);
  for (const item of loading) if (agentKey(item) === key) loading.delete(item);
  if (isSpoken(agent)) stopSpokenReply();
}

/**
 * The user starts a reading or a recording: the readings that wait are not read after it, and do
 * not stop it.
 */
function skipWaitingReadings(): void {
  readingsGeneration += 1;
}

/** Stops the reply that is read aloud, and the replies that load: the user speaks again. */
export function stopSpokenReply(): void {
  readingsGeneration += 1;
  loading.clear();
  spoken = undefined;
  stopSpeech();
}

/** Calls `listener` with the agent each time the reply to a dictated message ends. */
export function onDictatedReplyEnd(listener: (agent: SpeechAgent) => void): () => void {
  replyEndListeners.add(listener);
  return () => replyEndListeners.delete(listener);
}

function replyEnded(agent: SpeechAgent): void {
  for (const listener of replyEndListeners) listener(agent);
}

/**
 * Follows the turns of each agent: a user turn after a dictation takes the dictation, as does the
 * running turn that the dictated message steers. The completed answer of that turn is read aloud, and
 * in a voice conversation each progress update too, when it is complete. A new user turn of the agent
 * that is read aloud stops the reading.
 * `serverId` is the server that sent the event.
 */
export function readDictatedReplies(event: AgentEvent, serverId: string): void {
  if (event.type === "conversation") {
    readProgressUpdates(event.snapshot.messages, { serverId, agentId: event.snapshot.agentId });
    return;
  }
  // A remote server sends the newest page of the chat in place of the whole chat.
  if (event.type === "conversation-page") {
    readProgressUpdates(event.page.messages, { serverId, agentId: event.page.agentId });
    return;
  }
  if (event.type === "queue-changed") {
    const message = dictated.get(agentKey({ serverId, agentId: event.snapshot.agentId }));
    if (!message || message.turnId) return;
    // A steer that is not confirmed yet can fail, and the message then starts its own turn.
    for (const delivery of event.snapshot.deliveries)
      if (
        delivery.turnId &&
        delivery.turnId !== message.continuedTurnId &&
        delivery.status === "running" &&
        delivery.sender.kind === "user"
      )
        message.deliveryTurns.set(delivery.messageId, delivery.turnId);
    takeDeliveryTurn(message);
    return;
  }
  if (event.type !== "turn-started" && event.type !== "turn-completed") return;
  const agent = { serverId, agentId: event.agentId };
  const key = agentKey(agent);
  if (event.type === "turn-started") {
    if (event.origin === "routine" || event.origin === "agent") return;
    if (isSpoken(agent)) stopSpokenReply();
    const message = dictated.get(key);
    if (!message || message.turnId) return;
    if (Date.now() - message.dictatedAt > DICTATION_LIFETIME_MS) {
      dictated.delete(key);
      replyEnded(agent);
    } else message.turnId = event.turnId;
    return;
  }
  const message = dictated.get(key);
  if (!message || message.turnId !== event.turnId) return;
  if (event.status === "completed" && event.continues) {
    // The request continues in a new turn; its answer is the one to read.
    message.continuedTurnId = event.turnId;
    message.turnId = undefined;
    message.deliveryTurns.clear();
    return;
  }
  dictated.delete(key);
  if (event.status === "completed" && !event.quiet) void readReply(agent, event.turnId, message);
  // The progress updates of the turn play to their end before the pane listens again.
  else void afterReadings(async () => {}).finally(() => replyEnded(agent));
}

function readProgressUpdates(messages: readonly ConversationMessage[], agent: SpeechAgent): void {
  const key = agentKey(agent);
  const message = dictated.get(key);
  const progressUpdate = message?.progressUpdate;
  const turnId = message?.turnId;
  if (!message || !turnId || !progressUpdate) return;
  let read = readUpdates.get(key);
  if (read?.turnId !== turnId) {
    read = { turnId, ids: new Set() };
    readUpdates.set(key, read);
  }
  for (const update of messages) {
    // A stopped or failed turn ends its open update part way, so only a completed one is read.
    if (
      update.turnId !== turnId ||
      update.author !== "assistant" ||
      update.itemType !== "commentary" ||
      update.status !== "completed" ||
      read.ids.has(update.id) ||
      !progressUpdate(update)
    )
      continue;
    read.ids.add(update.id);
    const source = { ...agent, messageId: update.id };
    void afterReadings(() => speak(update.text, source, message.language, "progress_update"));
  }
}

async function readReply(agent: SpeechAgent, turnId: string, message: DictatedMessage): Promise<void> {
  const port = speechPort();
  const own = { ...agent };
  loading.add(own);
  try {
    if (!message.always && !(await port.voice.getSpeechSettings()).readReplies) return;
    // The server that sent the turn, also when the user selected another one since.
    const page = await port.agent.readConversationPage(
      { agentId: agent.agentId, anchor: { type: "latest" }, limit: ANSWER_LOOKUP_LIMIT },
      agent.serverId,
    );
    if (!loading.has(own)) return;
    loading.delete(own);
    const answer = latestTurnAnswer(page.messages, turnId);
    await afterReadings(() =>
      speak(
        answer?.text ?? "",
        { ...agent, messageId: answer?.id ?? null },
        message.language,
        message.always ? "voice_conversation" : "dictation",
      ),
    );
  } catch (error) {
    if (!loading.has(own)) return;
    desktopAnalytics.track("speech_reply", {
      trigger: message.always ? "voice_conversation" : "dictation",
      result: "failed",
      failure_code: "load_failed",
    });
    reportReadFailure(error);
  } finally {
    loading.delete(own);
    replyEnded(agent);
  }
}

/** Reads one message aloud, or stops it when it is the message that is read now. */
export function toggleReadAloud(source: SpeechSource & { messageId: string }, markdown: string): void {
  if (speechReading()?.messageId === source.messageId) {
    stopSpokenReply();
    return;
  }
  skipWaitingReadings();
  void speak(markdown, source, "en", "read_aloud");
}

/**
 * Pauses or resumes the reading of a message. Returns false when the message is not the one that
 * is read now.
 */
function pauseOrResumeSpeech(messageId: string): boolean {
  const reading = speechReading();
  if (reading?.messageId !== messageId) return false;
  if (reading.paused) resumeSpeech();
  else pauseSpeech();
  return true;
}

/** Plays the recording of a spoken message, or pauses or resumes it when it is the one that plays. */
export function toggleRecording(messageId: string, url: string): void {
  if (pauseOrResumeSpeech(messageId)) return;
  skipWaitingReadings();
  startRecording(messageId, url, 0);
}

/**
 * Plays the reply to a spoken message: its kept audio when it was read to its end before, otherwise
 * a new reading. Pauses or resumes it when it is the one that plays.
 */
export function toggleSpokenReply(source: SpeechSource & { messageId: string }, markdown: string): void {
  if (pauseOrResumeSpeech(source.messageId)) return;
  skipWaitingReadings();
  if (!playSpokenReply(source.messageId)) void speak(markdown, source, "en", "read_aloud");
}

/** Moves the kept audio of a reply to a position, in seconds, and plays it from there. */
export function seekSpokenReply(messageId: string, seconds: number): void {
  if (speechReading()?.messageId === messageId) seekSpeech(seconds);
  else {
    skipWaitingReadings();
    playSpokenReply(messageId, seconds);
  }
}

/** Moves the recording of a spoken message to a position, in seconds, and plays it from there. */
export function seekRecording(messageId: string, url: string, seconds: number): void {
  if (speechReading()?.messageId === messageId) seekSpeech(seconds);
  else {
    skipWaitingReadings();
    startRecording(messageId, url, seconds);
  }
}

/**
 * The duration and waveform of a recording. The first call decodes it; a failure shows nothing,
 * because the play control still works and reports its own failure.
 */
export function recordingWaveform(url: string): VoiceRecordingSummary | undefined {
  const summary = recordingSummary(url);
  if (!summary) loadRecording(url).catch(() => undefined);
  return summary;
}

function startRecording(messageId: string, url: string, from: number): void {
  // The cause is a fetch or decode failure, which says nothing useful to the user.
  playRecording(messageId, url, from).catch(() => {
    toast.error(currentText().t("chat.voice.playFailed"), {
      report: { operation: "voice", source: "system", cause_code: "unknown" },
    });
  });
}

function serverLanguage(fallback: SpeechLanguage): SpeechLanguage | null {
  return voiceServer()?.routes.speech ? fallback : null;
}

/** Reads a reply aloud. A failure shows a toast, because no control waits for the answer. */
async function speak(
  markdown: string,
  source: SpeechSource,
  fallback: SpeechLanguage,
  trigger: SpeechTrigger,
): Promise<void> {
  const own = { serverId: source.serverId, agentId: source.agentId };
  const analytics = desktopAnalytics.scope();
  try {
    const text = markdown ? speechTextFromMarkdown(markdown) : "";
    // Supertonic reads only its own languages. The user's server takes any text, and ignores the language.
    const language = text ? (speechLanguageOf(text, fallback) ?? serverLanguage(fallback)) : null;
    if (!language) return;
    spoken = own;
    // The first part takes longer to synthesize than the speed to load; a late speed applies at once.
    void loadSpeechSpeed();
    const result = await readAloud(text, language, source);
    analytics.track("speech_reply", {
      trigger,
      result: "succeeded",
      completed: result.completed,
      ...(result.firstAudioMs === null ? {} : { first_audio_ms: result.firstAudioMs }),
      audio_duration_seconds: Math.round(result.seconds * 10) / 10,
    });
  } catch (error) {
    analytics.track("speech_reply", { trigger, result: "failed", failure_code: "speech_failed" });
    reportReadFailure(error);
  } finally {
    if (spoken === own) spoken = undefined;
  }
}

function reportReadFailure(error: unknown): void {
  const { t, errorMessage } = currentText();
  toast.error(errorMessage(error, t("composer.voice.readFailed")), {
    report: { operation: "voice", source: "system", cause_code: "unknown" },
  });
}
