export interface ComposerField {
  text: string;
  typed: string;
  look: string;
  tagged: boolean;
  split: boolean;
  blank: boolean;
  clears: number;
}

export function composerField(text: string, look: string, tagged: boolean): ComposerField {
  return { text, typed: text, look, tagged, split: false, blank: false, clears: 0 };
}

export function syncComposerField(field: ComposerField, text: string, look: string, tagged: boolean): ComposerField {
  const shown = tagged ? text === field.text : text === field.typed;
  if (shown && tagged === field.tagged && look === field.look) return field;
  const sameTree = !tagged && !field.tagged && text === field.text && text !== field.typed;
  const splittable = Array.from(text).length > 1;
  return {
    text,
    typed: text,
    look,
    tagged,
    split: sameTree && splittable ? !field.split : field.split,
    blank: sameTree && text !== "" && !splittable,
    clears: sameTree && !text ? field.clears + 1 : field.clears,
  };
}

export function typedComposerField(field: ComposerField, typed: string): ComposerField {
  return field.typed === typed ? field : { ...field, typed };
}

export function shownComposerField(field: ComposerField): ComposerField {
  return field.blank ? { ...field, blank: false } : field;
}

export function composerFieldParts(field: ComposerField): [string, string] {
  if (field.blank) return ["", ""];
  if (!field.split) return [field.text, ""];
  const [head = "", ...tail] = Array.from(field.text);
  return [head, tail.join("")];
}
