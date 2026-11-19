import { useState } from "react";
import { readWaveformSource, receiveWaveformResult, useWaveformJobs, WAVEFORM_BARS } from "../model/audio-waveforms";
import AudioWaveformReader from "./audio-waveform.dom";
import { HIDDEN_DOM } from "./mermaid-renderer-host";

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
