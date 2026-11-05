import { Slider } from "heroui-native";
import type { PauseSliderProps } from "./pause-slider.types";

const first = (value: number | number[]) => (Array.isArray(value) ? (value[0] ?? 0) : value);

/** Android: the HeroUI slider. The iOS file uses the native SwiftUI slider. */
export function PauseSlider({
  value,
  minimum,
  maximum,
  step,
  disabled,
  label,
  onChange,
  onChangeEnd,
}: PauseSliderProps) {
  return (
    <Slider
      value={value}
      minValue={minimum}
      maxValue={maximum}
      step={step}
      isDisabled={disabled}
      onChange={(next) => onChange(first(next))}
      onChangeEnd={(next) => onChangeEnd(first(next))}
    >
      <Slider.Track>
        <Slider.Fill />
        <Slider.Thumb accessibilityLabel={label} />
      </Slider.Track>
    </Slider>
  );
}
