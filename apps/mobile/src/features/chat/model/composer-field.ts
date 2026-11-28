export interface ComposerField {
  text: string;
  typed: string;
  look: string;
  tagged: boolean;
  split: boolean;
  clears: number;
}

export function composerField(text: string, look: string, tagged: boolean): ComposerField {
  return { text, typed: text, look, tagged, split: false, clears: 0 };
}

export function syncComposerField(field: ComposerField, text: string, look: string, tagged: boolean): ComposerField {
  const shown = tagged ? text === field.text : text === field.typed;
  if (shown && tagged === field.tagged && look === field.look) return field;
  const sameTree = !tagged && !field.tagged && text === field.text && text !== field.typed;
  return {
    text,
    typed: text,
    look,
    tagged,
    split: sameTree && text ? !field.split : field.split,
    clears: sameTree && !text ? field.clears + 1 : field.clears,
  };
}

export function typedComposerField(field: ComposerField, typed: string): ComposerField {
  return field.typed === typed ? field : { ...field, typed };
}

export function composerFieldParts(field: ComposerField): [string, string] {
  if (!field.split) return [field.text, ""];
  const [head = "", ...tail] = Array.from(field.text);
  return [head, tail.join("")];
}
