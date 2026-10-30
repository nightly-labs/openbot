import { useState } from "react";
import { expoGoDomOptions } from "@/shared/lib/expo-go-dom";
import { readWaveformSource, receiveWaveformResult, useWaveformJobs, WAVEFORM_BARS } from "../model/audio-waveforms";
import AudioWaveformReader from "./audio-waveform.dom";

/**
 * Starts the waveform web view when the first audio file needs it and keeps it for the session,
 * so a chat with no audio never loads it. The web view is hidden and takes no touches.
 */
export function AudioWaveformHost() {
  const jobs = useWaveformJobs();
  const [started, setStarted] = useState(false);
  if (!started && jobs.length > 0) setStarted(true);
  if (!started) return null;
  return (
    <AudioWaveformReader
      jobs={jobs}
      bars={WAVEFORM_BARS}
      readSource={readWaveformSource}
      onResult={async (result) => receiveWaveformResult(result)}
      dom={{
        ...expoGoDomOptions,
        containerStyle: { flex: 0, height: 1, left: 0, opacity: 0, position: "absolute", top: 0, width: 1 },
        pointerEvents: "none",
        scrollEnabled: false,
        style: { flex: 0, height: 1, width: 1 },
      }}
    />
  );
}
