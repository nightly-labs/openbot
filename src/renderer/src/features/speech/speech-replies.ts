import {
  type AgentEvent,
  type ConversationMessage,
  latestTurnAnswer,
  type SpeechLanguage,
  speechAgentKey,
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
  releaseSpeech,
  resumeSpeech,
  type SpeechAgent,
  type SpeechSource,
  seekSpeech,
  setUpcomingReading,
  speechReading,
  stopSpeech,
  type UpcomingReading,
  type VoiceRecordingSummary,
} from "./speech-playback";
import { speechPort } from "./speech-port";
import { loadSpeechSpeed } from "./speech-speed";
import { voiceServer } from "./voice-server";

const DICTATION_LIFETIME_MS = 10 * 60_000;
const ANSWER_LOOKUP_LIMIT = 50;

interface DictatedMessage {
  dictatedAt: number;
  language: SpeechLanguage;
  turnId: string | undefined;
  sending: boolean;
  messageId: string | undefined;
  deliveryTurns: Map<string, string>;
  continuedTurnId: string | undefined;
  always: boolean;
  progressUpdate: ((message: ConversationMessage) => boolean) | undefined;
}

type SpeechTrigger = "voice_conversation" | "progress_update" | "dictation" | "read_aloud";

export type { SpeechAgent };

function agentKey(agent: SpeechAgent): string {
  return `${agent.serverId}\n${agent.agentId}`;
}

const dictated = new Map<string, DictatedMessage>();
let spoken: SpeechAgent | undefined;
const loading = new Set<SpeechAgent>();
const replyEndListeners = new Set<(agent: SpeechAgent) => void>();
const drops = new Map<string, number>();
let readings: Promise<void> = Promise.resolve();
let readingsGeneration = 0;
const waitingReadings: UpcomingReading[] = [];
const readUpdates = new Map<string, { turnId: string; ids: Set<string> }>();

function afterReadings(read: () => Promise<void>): Promise<void> {
  const own = readingsGeneration;
  const next = readings.then(() => (own === readingsGeneration ? read() : undefined));
  readings = next.catch(() => undefined);
  return next;
}

function readAfterReadings(
  markdown: string,
  source: SpeechSource,
  fallback: SpeechLanguage,
  trigger: SpeechTrigger,
): Promise<void> {
  const waiting = speechInput(markdown, fallback, speechAgentKey(source.serverId, source.agentId));
  if (waiting) {
    waitingReadings.push(waiting);
    if (waitingReadings.length === 1) setUpcomingReading(waiting);
  }
  return afterReadings(() => {
    const index = waiting ? waitingReadings.indexOf(waiting) : -1;
    if (index >= 0) waitingReadings.splice(index, 1);
    const read = speak(markdown, source, fallback, trigger, waiting);
    setUpcomingReading(waitingReadings[0]);
    return read;
  });
}

function forgetWaitingReadings(): void {
  waitingReadings.length = 0;
  setUpcomingReading(undefined);
}

function isSpoken(agent: SpeechAgent): boolean {
  return spoken?.serverId === agent.serverId && spoken.agentId === agent.agentId;
}

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

async function warmSpeech(always: boolean): Promise<void> {
  const voice = speechPort().voice;
  try {
    if (!always && !(await voice.getSpeechSettings()).readReplies) return;
    await voice.warmSpeech();
  } catch {}
}

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

export function forgetDictatedMessage(agent: SpeechAgent): void {
  const key = agentKey(agent);
  if (!dictated.get(key)?.turnId) dictated.delete(key);
}

export function dropDictatedReply(agent: SpeechAgent): void {
  const key = agentKey(agent);
  drops.set(key, (drops.get(key) ?? 0) + 1);
  releaseSpeech(agent, false);
  dictated.delete(key);
  for (const item of loading) if (agentKey(item) === key) loading.delete(item);
  if (isSpoken(agent)) stopSpokenReply();
}

function skipWaitingReadings(): void {
  readingsGeneration += 1;
  forgetWaitingReadings();
}

export function stopSpokenReply(): void {
  readingsGeneration += 1;
  forgetWaitingReadings();
  loading.clear();
  spoken = undefined;
  stopSpeech();
}

export function onDictatedReplyEnd(listener: (agent: SpeechAgent) => void): () => void {
  replyEndListeners.add(listener);
  return () => replyEndListeners.delete(listener);
}

function replyEnded(agent: SpeechAgent): void {
  for (const listener of replyEndListeners) listener(agent);
}

function replyEndedUnlessDropped(agent: SpeechAgent): () => void {
  const key = agentKey(agent);
  const before = drops.get(key);
  return () => {
    if (drops.get(key) === before) replyEnded(agent);
  };
}

export function readDictatedReplies(event: AgentEvent, serverId: string): void {
  if (event.type === "conversation") {
    readProgressUpdates(event.snapshot.messages, { serverId, agentId: event.snapshot.agentId });
    return;
  }
  if (event.type === "conversation-page") {
    readProgressUpdates(event.page.messages, { serverId, agentId: event.page.agentId });
    return;
  }
  if (event.type === "queue-changed") {
    const message = dictated.get(agentKey({ serverId, agentId: event.snapshot.agentId }));
    if (!message || message.turnId) return;
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
    if (event.origin === "unknown") return;
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
    message.continuedTurnId = event.turnId;
    message.turnId = undefined;
    message.deliveryTurns.clear();
    return;
  }
  dictated.delete(key);
  if (event.status === "completed" && !event.quiet) void readReply(agent, event.turnId, message);
  else void afterReadings(async () => {}).finally(replyEndedUnlessDropped(agent));
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
    void readAfterReadings(update.text, source, message.language, "progress_update");
  }
}

async function readReply(agent: SpeechAgent, turnId: string, message: DictatedMessage): Promise<void> {
  const port = speechPort();
  const own = { ...agent };
  const ended = replyEndedUnlessDropped(agent);
  loading.add(own);
  try {
    if (!message.always && !(await port.voice.getSpeechSettings()).readReplies) return;
    const page = await port.agent.readConversationPage(
      { agentId: agent.agentId, anchor: { type: "latest" }, limit: ANSWER_LOOKUP_LIMIT },
      agent.serverId,
    );
    if (!loading.has(own)) return;
    loading.delete(own);
    const answer = latestTurnAnswer(page.messages, turnId);
    const read = readUpdates.get(agentKey(agent));
    const heard = answer !== undefined && read?.turnId === turnId && read.ids.has(answer.id);
    await readAfterReadings(
      heard ? "" : (answer?.text ?? ""),
      { ...agent, messageId: answer?.id ?? null },
      message.language,
      message.always ? "voice_conversation" : "dictation",
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
    ended();
  }
}

export function toggleReadAloud(source: SpeechSource & { messageId: string }, markdown: string): void {
  if (speechReading()?.messageId === source.messageId) {
    stopSpokenReply();
    return;
  }
  skipWaitingReadings();
  void speak(markdown, source, "en", "read_aloud");
}

function pauseOrResumeSpeech(messageId: string): boolean {
  const reading = speechReading();
  if (reading?.messageId !== messageId) return false;
  if (reading.paused) resumeSpeech();
  else pauseSpeech();
  return true;
}

export function toggleRecording(messageId: string, url: string): void {
  if (pauseOrResumeSpeech(messageId)) return;
  skipWaitingReadings();
  startRecording(messageId, url, 0);
}

export function toggleSpokenReply(source: SpeechSource & { messageId: string }, markdown: string): void {
  if (pauseOrResumeSpeech(source.messageId)) return;
  skipWaitingReadings();
  if (!playSpokenReply(source.messageId)) void speak(markdown, source, "en", "read_aloud");
}

export function seekSpokenReply(messageId: string, seconds: number): void {
  if (speechReading()?.messageId === messageId) seekSpeech(seconds);
  else {
    skipWaitingReadings();
    playSpokenReply(messageId, seconds);
  }
}

export function seekRecording(messageId: string, url: string, seconds: number): void {
  if (speechReading()?.messageId === messageId) seekSpeech(seconds);
  else {
    skipWaitingReadings();
    startRecording(messageId, url, seconds);
  }
}

export function recordingWaveform(url: string): VoiceRecordingSummary | undefined {
  const summary = recordingSummary(url);
  if (!summary) loadRecording(url).catch(() => undefined);
  return summary;
}

function startRecording(messageId: string, url: string, from: number): void {
  playRecording(messageId, url, from).catch(() => {
    toast.error(currentText().t("chat.voice.playFailed"), {
      report: { operation: "voice", source: "system", cause_code: "unknown" },
    });
  });
}

function serverLanguage(fallback: SpeechLanguage): SpeechLanguage | null {
  return voiceServer()?.routes.speech ? fallback : null;
}

function speechInput(markdown: string, fallback: SpeechLanguage, agentKey?: string): UpcomingReading | undefined {
  const text = markdown ? speechTextFromMarkdown(markdown) : "";
  const language = text ? (speechLanguageOf(text, fallback) ?? serverLanguage(fallback)) : null;
  return language ? { text, language, ...(agentKey ? { agentKey } : {}) } : undefined;
}

async function speak(
  markdown: string,
  source: SpeechSource,
  fallback: SpeechLanguage,
  trigger: SpeechTrigger,
  prepared?: UpcomingReading,
): Promise<void> {
  const own = { serverId: source.serverId, agentId: source.agentId };
  const analytics = desktopAnalytics.scope();
  try {
    const input = speechInput(markdown, fallback);
    if (!input) {
      if (markdown && speechTextFromMarkdown(markdown)) reportUnreadableLanguage();
      return;
    }
    spoken = own;
    void loadSpeechSpeed();
    const result = await readAloud(input.text, input.language, source, prepared);
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

function reportUnreadableLanguage(): void {
  toast.warning(currentText().t("composer.voice.languageUnsupported"), {
    id: "speech-unsupported-language",
    report: { operation: "voice", source: "system", cause_code: "unknown" },
  });
}

function reportReadFailure(error: unknown): void {
  const { t, errorMessage } = currentText();
  toast.error(errorMessage(error, t("composer.voice.readFailed")), {
    report: { operation: "voice", source: "system", cause_code: "unknown" },
  });
}
