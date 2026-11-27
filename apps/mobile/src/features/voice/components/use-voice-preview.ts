import { useEffect, useRef, useState } from "react";
import { currentText } from "@/shared/lib/text";
import { type ReplyReading, type ReplyVoiceChoice, readReply, replyVoiceFailureText } from "../model/reply-voice";

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
        onError: (failure, reason) => {
          setPlaying((current) => (current === id ? null : current));
          setError(replyVoiceFailureText(failure, reason));
        },
      },
      choice,
    );
  };
  return { playing, error, toggle, stop };
}
