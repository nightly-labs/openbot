export interface RoutineActiveSwitchProps {
  /** The routine name. Screen readers read it; the card shows it already. */
  label: string;
  value: boolean;
  disabled: boolean;
  onValueChange: (value: boolean) => void;
}
