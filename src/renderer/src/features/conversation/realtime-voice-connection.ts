/*! @license
 * Adapted from CopilotKit/OpenBot app/src/lib/voice/{types,webrtc}.ts
 * https://github.com/CopilotKit/OpenBot/tree/947955a57ba600a37906462a6d267b7abb6da7fc/app/src/lib/voice
 *
 * MIT License
 * Copyright (c) 2026 CopilotKit
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import type { RealtimeVoiceAnswer } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";

interface RealtimeResponse {
  id?: string;
  status?: string;
  metadata?: { openbot_voice_turn?: string } | null;
  output?: Array<{ content?: Array<{ type?: string }> }>;
}

export interface RealtimeVoiceEvent {
  type: string;
  item_id?: string;
  transcript?: string;
  response_id?: string;
  response?: RealtimeResponse;
  error?: { code?: string };
  item?: { text?: string };
  turn?: { role?: string; transcript?: string };
}

type RealtimeVoiceCommand =
  | { type: "response.cancel"; response_id?: string }
  | { type: "output_audio_buffer.clear" }
  | {
      type: "response.create";
      response: {
        conversation: "none";
        input: Array<{ type: "message"; role: "assistant"; content: Array<{ type: "text"; text: string }> }>;
        instructions: string;
        tool_choice: "none";
        metadata: { openbot_voice_turn: string };
      };
    };

function optionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

/** Provider events are decoded before the call controller reads nested fields. */
function isRealtimeVoiceEvent(value: unknown): value is RealtimeVoiceEvent {
  if (!isDynamicRecord(value) || typeof value.type !== "string") return false;
  if (!optionalString(value.item_id) || !optionalString(value.transcript) || !optionalString(value.response_id))
    return false;
  if (value.error !== undefined && (!isDynamicRecord(value.error) || !optionalString(value.error.code))) return false;
  if (value.item !== undefined && (!isDynamicRecord(value.item) || !optionalString(value.item.text))) return false;
  if (
    value.turn !== undefined &&
    (!isDynamicRecord(value.turn) || !optionalString(value.turn.role) || !optionalString(value.turn.transcript))
  )
    return false;
  if (value.response === undefined) return true;
  const response = value.response;
  if (!isDynamicRecord(response) || !optionalString(response.id) || !optionalString(response.status)) return false;
  if (
    response.metadata !== undefined &&
    response.metadata !== null &&
    (!isDynamicRecord(response.metadata) || !optionalString(response.metadata.openbot_voice_turn))
  )
    return false;
  return (
    response.output === undefined ||
    (Array.isArray(response.output) &&
      response.output.every(
        (item) =>
          isDynamicRecord(item) &&
          (item.content === undefined ||
            (Array.isArray(item.content) &&
              item.content.every((part) => isDynamicRecord(part) && optionalString(part.type)))),
      ))
  );
}

export interface RealtimeVoiceConnection {
  stream: MediaStream;
  send(event: RealtimeVoiceCommand): void;
  mute(muted: boolean): void;
  silenceOutput(silent: boolean): void;
  close(): void;
}

interface ConnectionOptions {
  signal: AbortSignal;
  exchange(sdp: string): Promise<RealtimeVoiceAnswer>;
  onEvent(event: RealtimeVoiceEvent): void;
  onError(): void;
  onOutput(stream: MediaStream): void;
}

/** The host exchanges SDP. No provider credential or HTTP endpoint enters the renderer. */
export async function connectRealtimeVoice(options: ConnectionOptions): Promise<RealtimeVoiceConnection> {
  options.signal.throwIfAborted();
  let stream: MediaStream | undefined;
  let peer: RTCPeerConnection | undefined;
  let channel: RTCDataChannel | undefined;
  let audio: HTMLAudioElement | undefined;
  let closed = false;
  let opened: (() => void) | undefined;
  let subscription = false;
  let channelOpened = false;
  let providerStarted = false;
  function completeConnection(): void {
    if (channelOpened && (!subscription || providerStarted)) opened?.();
  }
  let rejected: (() => void) | undefined;
  const ready = new Promise<void>((resolve, reject) => {
    opened = resolve;
    rejected = () => reject(new DOMException("", "AbortError"));
  });
  // A failure can happen before the offer exchange reaches the wait below.
  void ready.catch(() => {});

  function close(): void {
    if (closed) return;
    closed = true;
    options.signal.removeEventListener("abort", close);
    rejected?.();
    channel?.close();
    peer?.close();
    for (const track of stream?.getTracks() ?? []) track.stop();
    if (audio) {
      audio.pause();
      audio.srcObject = null;
    }
  }

  function failed(): void {
    if (closed) return;
    close();
    options.onError();
  }

  options.signal.addEventListener("abort", close, { once: true });
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    if (closed || options.signal.aborted) {
      for (const track of stream.getTracks()) track.stop();
      throw new DOMException("", "AbortError");
    }
    peer = new RTCPeerConnection();
    audio = new Audio();
    audio.autoplay = true;
    peer.ontrack = (event) => {
      if (closed || !audio) return;
      const output = event.streams[0] ?? new MediaStream([event.track]);
      audio.srcObject = output;
      options.onOutput(output);
      void audio.play().catch(failed);
    };
    peer.onconnectionstatechange = () => {
      if (peer?.connectionState === "failed" || peer?.connectionState === "disconnected") failed();
    };
    for (const track of stream.getTracks()) {
      track.addEventListener("ended", failed, { once: true });
      peer.addTrack(track, stream);
    }
    channel = peer.createDataChannel("oai-events");
    channel.onopen = () => {
      channelOpened = true;
      completeConnection();
    };
    channel.onerror = failed;
    channel.onclose = failed;
    channel.onmessage = (message) => {
      if (closed || typeof message.data !== "string" || message.data.length > 256_000) return;
      try {
        const value = JSON.parse(message.data);
        if (isDynamicRecord(value) && value.type === "session.started") {
          providerStarted = true;
          completeConnection();
        }
        if (isRealtimeVoiceEvent(value)) options.onEvent(value);
      } catch {
        failed();
      }
    };
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    options.signal.throwIfAborted();
    const answer = await options.exchange(offer.sdp ?? "");
    subscription = Boolean(answer.sessionId);
    options.signal.throwIfAborted();
    if (closed) throw new DOMException("", "AbortError");
    await peer.setRemoteDescription({ type: "answer", sdp: answer.sdp });
    await ready;
    options.signal.throwIfAborted();
    return {
      stream,
      send(event) {
        if (!closed && channel?.readyState === "open") channel.send(JSON.stringify(event));
      },
      mute(muted) {
        for (const track of stream?.getAudioTracks() ?? []) track.enabled = !muted;
      },
      silenceOutput(silent) {
        if (audio) audio.muted = silent;
      },
      close,
    };
  } catch (error) {
    close();
    throw error;
  }
}
