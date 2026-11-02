import { useEffect, useRef, useState } from "react";
import { currentText } from "@/shared/lib/text";
import { REPLY_VOICE_FAILURE_TEXT, type ReplyReading, type ReplyVoiceChoice, readReply } from "../model/reply-voice";

/**
 * Plays a short sample with a voice. One sample plays at a time; `playing` names it, so each voice
 * can show Play or Stop. Leaving the page stops it.
 */
export function useVoicePreview() {
  const [playing, setPlaying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reading = useRef<ReplyReading | null>(null);
  useEffect(() => () => reading.current?.stop(), []);
  const stop = () => {
    reading.current?.stop();
    reading.current = null;
    setPlaying(null);
  };
  /** Plays the sample with `choice`, or stops it when `id` is the sample that plays. */
  const toggle = (id: string, choice?: ReplyVoiceChoice) => {
    const same = playing === id;
    stop();
    if (same) return;
    setError(null);
    setPlaying(id);
    reading.current = readReply(
      currentText().t("mobile.settings.voice.sample"),
      {
        onPart: () => undefined,
        onDone: () => setPlaying((current) => (current === id ? null : current)),
        onError: (failure) => {
          setPlaying((current) => (current === id ? null : current));
          setError(currentText().t(REPLY_VOICE_FAILURE_TEXT[failure]));
        },
      },
      choice,
    );
  };
  return { playing, error, toggle, stop };
}
