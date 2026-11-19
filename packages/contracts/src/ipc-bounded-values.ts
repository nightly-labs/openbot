import { INPUT_LIMITS } from "./input-limits";
import { isNumber, isString } from "./runtime-values";

export function isBoundedString(value: unknown, maximum: number): value is string {
  return isString(value) && value.length <= maximum;
}

export function isNullableBoundedString(value: unknown, maximum: number): value is string | null {
  return value === null || isBoundedString(value, maximum);
}

export function isIdentifier(value: unknown): value is string {
  return isBoundedString(value, INPUT_LIMITS.identifier) && value.length > 0;
}

export function isRequestId(value: unknown): value is string | number {
  return isNumber(value) || isIdentifier(value);
}

export function isFiniteNumber(value: unknown): value is number {
  return isNumber(value) && Number.isFinite(value);
}

export function integerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return isNumber(value) && Number.isInteger(value) && value >= minimum && value <= maximum;
}
