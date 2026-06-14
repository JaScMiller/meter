import type { PartOfSpeech } from "wink-nlp";

// My internal POS representation
export type CanonicalPos =
    | "ADJ"
    | "ADP"
    | "ADV"
    | "AUX"
    | "CCONJ"
    | "DET"
    | "INTJ"
    | "NOUN"
    | "NUM"
    | "PART"
    | "PRON"
    | "PROPN"
    | "PUNCT"
    | "SCONJ"
    | "SYM"
    | "VERB"
    | "X";

export function normaliseDictionaryPos(pos: string): CanonicalPos {
    switch (pos.trim().toLowerCase()) {
        case "noun":
            return "NOUN";

        case "proper noun":
        case "name":
            return "PROPN";

        case "verb":
            return "VERB";

        case "adjective":
        case "adj":
            return "ADJ";

        case "adverb":
        case "adv":
            return "ADV";

        case "preposition":
        case "postposition":
        case "adposition":
            return "ADP";

        case "pronoun":
            return "PRON";

        case "determiner":
        case "article":
            return "DET";

        case "conjunction":
        case "coordinating conjunction":
            return "CCONJ";

        case "subordinating conjunction":
            return "SCONJ";

        case "particle":
            return "PART";

        case "numeral":
        case "number":
            return "NUM";

        case "interjection":
            return "INTJ";

        case "symbol":
            return "SYM";

        default:
            return "X";
    }
}

export function normalizeNlpPos(
  value: PartOfSpeech,
): CanonicalPos {
  switch (value.trim().toLowerCase()) {
    case "noun":
    case "n":
      return "NOUN";

    case "proper noun":
    case "propn":
      return "PROPN";

    case "verb":
    case "v":
      return "VERB";

    case "adjective":
    case "adj":
      return "ADJ";

    case "adverb":
    case "adv":
      return "ADV";

    case "adposition":
    case "preposition":
    case "postposition":
    case "adp":
      return "ADP";

    case "auxiliary":
    case "aux":
      return "AUX";

    case "determiner":
    case "det":
      return "DET";

    case "pronoun":
    case "pron":
      return "PRON";

    case "particle":
    case "part":
      return "PART";

    case "number":
    case "numeral":
    case "num":
      return "NUM";

    default:
      return "X";
  }
}