// The `Text` and `TextInput` that the Uniwind wrappers render (see `uniwind-react-native.js`), so every
// text takes the text size of Settings › Appearance. Native chrome, such as navigation bars and system
// menus, keeps the text size of the phone settings.
import {
  Text as NativeText,
  TextInput as NativeTextInput,
  PixelRatio,
  type StyleProp,
  StyleSheet,
  type TextInputProps,
  type TextProps,
  type TextStyle,
} from "openbot-original-react-native";
import { useTextSize } from "@/features/settings/model/text-size-store";

/**
 * The multiplier for a text, as the phone applies its own text size: none with
 * `allowFontScaling={false}`, and with `maxFontSizeMultiplier` the phone and app sizes together stay
 * under the limit.
 */
function useScale(allowFontScaling: boolean | undefined, maxFontSizeMultiplier: number | null | undefined) {
  const percent = useTextSize((state) => state.percent);
  if (percent === 100 || allowFontScaling === false) return 1;
  const scale = percent / 100;
  if (!maxFontSizeMultiplier || maxFontSizeMultiplier < 1 || scale < 1) return scale;
  return Math.max(1, Math.min(scale, maxFontSizeMultiplier / PixelRatio.getFontScale()));
}

function scaledStyle(style: StyleProp<TextStyle>, scale: number): StyleProp<TextStyle> {
  if (scale === 1) return style;
  const { fontSize, lineHeight, letterSpacing } = StyleSheet.flatten(style) ?? {};
  if (fontSize === undefined && lineHeight === undefined && letterSpacing === undefined) return style;
  const scaled: TextStyle = {
    ...(fontSize === undefined ? {} : { fontSize: fontSize * scale }),
    ...(lineHeight === undefined ? {} : { lineHeight: lineHeight * scale }),
    ...(letterSpacing === undefined ? {} : { letterSpacing: letterSpacing * scale }),
  };
  return [style, scaled];
}

export function Text(props: TextProps) {
  const scale = useScale(props.allowFontScaling, props.maxFontSizeMultiplier);
  return <NativeText {...props} style={scaledStyle(props.style, scale)} />;
}

function ScaledTextInput(props: TextInputProps) {
  const scale = useScale(props.allowFontScaling, props.maxFontSizeMultiplier);
  return <NativeTextInput {...props} style={scaledStyle(props.style, scale)} />;
}

// Libraries read the focused field from `TextInput.State`, which the Uniwind wrapper copies from here.
export const TextInput = Object.assign(ScaledTextInput, { State: NativeTextInput.State });
