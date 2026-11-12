export interface PauseSliderProps {
  value: number;
  minimum: number;
  maximum: number;
  step: number;
  disabled: boolean;
  /** Names the slider for VoiceOver and TalkBack. */
  label: string;
  /** Each step while the finger moves. */
  onChange: (value: number) => void;
  /** The value when the finger lifts. */
  onChangeEnd: (value: number) => void;
}
