import type { SpeechLanguage } from "./ipc-voice";

/**
 * The Latin-script languages that Supertonic 3 reads: their frequent short words, and the letters
 * that only some of them use. A matched letter counts as two matched words; the language with the
 * highest count wins.
 */
const LATIN_LANGUAGES: readonly { language: SpeechLanguage; words: ReadonlySet<string>; letters?: RegExp }[] = [
  {
    language: "en",
    words: new Set([
      "the",
      "and",
      "is",
      "are",
      "you",
      "to",
      "of",
      "it",
      "that",
      "this",
      "with",
      "for",
      "not",
      "have",
      "was",
    ]),
  },
  {
    language: "de",
    words: new Set([
      "der",
      "die",
      "das",
      "und",
      "ist",
      "nicht",
      "ich",
      "sie",
      "mit",
      "ein",
      "eine",
      "auf",
      "für",
      "auch",
      "wir",
    ]),
    letters: /[ßäöü]/gu,
  },
  {
    language: "es",
    words: new Set([
      "el",
      "la",
      "los",
      "las",
      "que",
      "y",
      "es",
      "en",
      "por",
      "para",
      "con",
      "una",
      "del",
      "pero",
      "está",
    ]),
    letters: /[ñ¿¡]/gu,
  },
  {
    language: "fr",
    words: new Set([
      "le",
      "la",
      "les",
      "et",
      "est",
      "une",
      "des",
      "que",
      "pour",
      "pas",
      "avec",
      "dans",
      "vous",
      "je",
      "sur",
    ]),
    letters: /[çèêàùœ]/gu,
  },
  {
    language: "it",
    words: new Set([
      "il",
      "che",
      "è",
      "di",
      "per",
      "una",
      "sono",
      "non",
      "con",
      "gli",
      "della",
      "anche",
      "questo",
      "come",
      "ma",
    ]),
  },
  {
    language: "pt",
    words: new Set([
      "o",
      "os",
      "que",
      "não",
      "é",
      "uma",
      "com",
      "para",
      "do",
      "da",
      "em",
      "você",
      "mas",
      "isso",
      "está",
    ]),
    letters: /[ãõç]/gu,
  },
  {
    language: "nl",
    words: new Set([
      "de",
      "het",
      "een",
      "en",
      "is",
      "niet",
      "van",
      "dat",
      "ik",
      "je",
      "met",
      "voor",
      "zijn",
      "op",
      "ook",
    ]),
  },
  {
    language: "pl",
    words: new Set(["i", "w", "nie", "to", "się", "na", "jest", "że", "z", "do", "co", "jak", "ale", "tak", "czy"]),
    letters: /[łąęśźżćń]/gu,
  },
  {
    language: "cs",
    words: new Set([
      "a",
      "je",
      "se",
      "na",
      "že",
      "to",
      "v",
      "není",
      "jsem",
      "jak",
      "ale",
      "pro",
      "jsou",
      "také",
      "nebo",
    ]),
    letters: /[řůě]/gu,
  },
  {
    language: "sk",
    words: new Set(["a", "je", "sa", "na", "že", "to", "v", "nie", "som", "ako", "ale", "pre", "sú", "aj", "alebo"]),
    letters: /[ľĺŕôä]/gu,
  },
  {
    language: "sv",
    words: new Set([
      "och",
      "är",
      "det",
      "att",
      "en",
      "som",
      "inte",
      "jag",
      "på",
      "med",
      "för",
      "har",
      "den",
      "till",
      "av",
    ]),
    letters: /[å]/gu,
  },
  {
    language: "da",
    words: new Set([
      "og",
      "er",
      "det",
      "at",
      "en",
      "som",
      "ikke",
      "jeg",
      "på",
      "med",
      "for",
      "har",
      "den",
      "til",
      "af",
    ]),
    letters: /[æø]/gu,
  },
  {
    language: "fi",
    words: new Set([
      "ja",
      "on",
      "ei",
      "se",
      "että",
      "hän",
      "mutta",
      "kun",
      "tämä",
      "ovat",
      "myös",
      "voi",
      "olla",
      "mitä",
      "niin",
    ]),
  },
  {
    language: "et",
    words: new Set([
      "ja",
      "on",
      "ei",
      "see",
      "et",
      "aga",
      "kui",
      "ka",
      "või",
      "mis",
      "oma",
      "nii",
      "siis",
      "olla",
      "seda",
    ]),
    letters: /[õ]/gu,
  },
  {
    language: "hu",
    words: new Set([
      "a",
      "az",
      "és",
      "hogy",
      "nem",
      "egy",
      "is",
      "van",
      "meg",
      "de",
      "ez",
      "csak",
      "már",
      "mint",
      "ha",
    ]),
    letters: /[őű]/gu,
  },
  {
    language: "ro",
    words: new Set([
      "și",
      "este",
      "nu",
      "în",
      "la",
      "cu",
      "pe",
      "care",
      "un",
      "o",
      "să",
      "pentru",
      "mai",
      "sunt",
      "din",
    ]),
    letters: /[șțăâî]/gu,
  },
  {
    language: "tr",
    words: new Set([
      "ve",
      "bir",
      "bu",
      "da",
      "de",
      "için",
      "ile",
      "çok",
      "ama",
      "ne",
      "değil",
      "var",
      "gibi",
      "daha",
      "olan",
    ]),
    letters: /[ğış]/gu,
  },
  {
    language: "id",
    words: new Set([
      "dan",
      "yang",
      "di",
      "ini",
      "itu",
      "dengan",
      "untuk",
      "tidak",
      "ada",
      "dari",
      "saya",
      "akan",
      "juga",
      "anda",
      "bisa",
    ]),
  },
  {
    language: "hr",
    words: new Set(["i", "je", "u", "da", "se", "na", "su", "za", "ne", "od", "što", "ali", "kao", "biti", "ili"]),
    letters: /[đ]/gu,
  },
  {
    language: "sl",
    words: new Set(["in", "je", "da", "se", "na", "v", "za", "ne", "so", "pa", "kot", "tudi", "ali", "bi", "lahko"]),
  },
  {
    language: "lt",
    words: new Set([
      "ir",
      "yra",
      "kad",
      "ne",
      "su",
      "į",
      "iš",
      "bet",
      "kaip",
      "tai",
      "jis",
      "ji",
      "buvo",
      "dar",
      "arba",
    ]),
    letters: /[ėįųū]/gu,
  },
  {
    language: "lv",
    words: new Set(["un", "ir", "ka", "ne", "ar", "uz", "par", "bet", "kā", "tas", "no", "vai", "arī", "jūs", "es"]),
    letters: /[āēīūļņķģ]/gu,
  },
  {
    language: "vi",
    words: new Set([
      "và",
      "là",
      "của",
      "có",
      "không",
      "được",
      "cho",
      "này",
      "với",
      "một",
      "các",
      "những",
      "trong",
      "bạn",
      "đã",
    ]),
    letters: /[ơưăđạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/gu,
  },
];

function count(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

/**
 * The language to read a reply in, from its letters and its frequent words. It answers null for a
 * script that Supertonic 3 does not read, such as Chinese or Hebrew, and `fallback` when the words
 * do not show a language.
 */
export function speechLanguageOf(text: string, fallback: SpeechLanguage): SpeechLanguage | null {
  const letters = count(text, /\p{L}/gu);
  if (letters === 0) return fallback;
  const share = (pattern: RegExp) => count(text, pattern) / letters;
  if (share(/[぀-ヿ]/gu) > 0.05) return "ja";
  if (share(/[가-힯ᄀ-ᇿ㄰-㆏]/gu) > 0.2) return "ko";
  if (share(/\p{Script=Han}/gu) > 0.2) return null;
  if (share(/\p{Script=Arabic}/gu) > 0.2) return "ar";
  if (share(/\p{Script=Greek}/gu) > 0.2) return "el";
  if (share(/\p{Script=Devanagari}/gu) > 0.2) return "hi";
  if (share(/\p{Script=Cyrillic}/gu) > 0.2) {
    const lower = text.toLowerCase();
    if (count(lower, /[іїєґ]/gu) > 0) return "uk";
    if (count(lower, /[ыэё]/gu) === 0 && count(lower, /ъ/gu) > 0) return "bg";
    return "ru";
  }
  if (share(/\p{Script=Latin}/gu) < 0.5) return null;
  return latinLanguage(text) ?? fallback;
}

function latinLanguage(text: string): SpeechLanguage | null {
  const lower = text.toLowerCase();
  const words = lower.match(/\p{L}+/gu) ?? [];
  let best: SpeechLanguage | null = null;
  let bestScore = 0;
  for (const { language, words: known, letters } of LATIN_LANGUAGES) {
    let score = words.filter((word) => known.has(word)).length;
    if (letters) score += 2 * count(lower, letters);
    if (score > bestScore) {
      best = language;
      bestScore = score;
    }
  }
  return bestScore >= 2 ? best : null;
}
