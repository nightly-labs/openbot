export interface PauseSliderProps {
  value: number;
  minimum: number;
  maximum: number;
  step: number;
  disabled: boolean;
  label: string;
  onChange: (value: number) => void;
  onChangeEnd: (value: number) => void;
}
