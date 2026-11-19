import { useState } from "react";
import { readWaveformSource, receiveWaveformResult, useWaveformJobs, WAVEFORM_BARS } from "../model/audio-waveforms";
import AudioWaveformReader from "./audio-waveform.dom";
import { HIDDEN_DOM } from "./mermaid-renderer-host";

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
      dom={HIDDEN_DOM}
    />
  );
}
