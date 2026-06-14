import pronunciationData from '../../pronounciation.json'
import type { DictionaryEntry } from './dictionary'

export type PronunciationResolution<T> = {
  value: T | null
  reason: string | null
}

export type JsonPronunciationValue = number[]

export type UserDefinedStressMap = Record<string, number[][]>

interface DictionaryPronunciationEntry {
  type?: string
  text?: string
  tags?: string[]
}

interface DictionaryRawEntry {
  pronunciations?: DictionaryPronunciationEntry[]
}

type PronunciationDictionary = Record<string, { pronunciation: string; stresses: number[] }[]>

const pronunciationDictionary = pronunciationData as PronunciationDictionary
const userDefinedStressStorageKey = 'my-react-exp:user-defined-stresses:v1'

export function lookupJsonPronunciation(word: string): PronunciationResolution<JsonPronunciationValue> {
  const key = normalizeWord(word)
  const entries = pronunciationDictionary[key]

  if (!Array.isArray(entries) || entries.length === 0) {
    return {
      value: null,
      reason: `No JSON pronunciation entry found for "${word}".`,
    }
  }

  const stressPatterns = entries
    .map((entry) => entry.stresses)
    .filter((stresses): stresses is number[] => Array.isArray(stresses))

  if (stressPatterns.length === 0) {
    return {
      value: null,
      reason: `JSON pronunciation entry for "${word}" is missing stress information.`,
    }
  }

  const uniqueStressPatterns = dedupeStressPatterns(stressPatterns)

  if (uniqueStressPatterns.length > 1) {
    if (areAllMonosyllableStressVariants(uniqueStressPatterns)) {
      return {
        value: [...uniqueStressPatterns[0]],
        reason: null,
      }
    }

    return {
      value: null,
      reason: `Multiple unique JSON stress patterns found for "${word}".`,
    }
  }

  return {
    value: [...uniqueStressPatterns[0]],
    reason: null,
  }
}

export function lookupDictionaryPronunciation(
  dictionaryEntry: DictionaryEntry | null,
  lookupText: string | null,
  unitText: string,
): PronunciationResolution<number[][]> {
  if (!dictionaryEntry) {
    return {
      value: null,
      reason: 'No dictionary entry available.',
    }
  }

  if (!lookupText || lookupText.trim().length === 0) {
    return {
      value: null,
      reason: 'No lookup text available for dictionary pronunciation.',
    }
  }

  if (normalizeWord(unitText) !== normalizeWord(lookupText)) {
    return {
      value: null,
      reason: `Word "${unitText}" was looked up as "${lookupText}", so dictionary pronunciation is not valid.`,
    }
  }

  const rawEntry = dictionaryEntry.rawEntry

  if (!rawEntry || typeof rawEntry !== 'object') {
    return {
      value: null,
      reason: 'Dictionary entry format is not readable.',
    }
  }

  const candidate = rawEntry as DictionaryRawEntry
  const pronunciations = candidate.pronunciations

  if (!Array.isArray(pronunciations) || pronunciations.length === 0) {
    return {
      value: null,
      reason: 'Dictionary entry has no pronunciations.',
    }
  }

  const rpPronunciations = pronunciations.filter((pronunciation) => {
    const hasReceivedPronunciationTag =
      Array.isArray(pronunciation.tags) &&
      pronunciation.tags.some((tag) => tag === 'Received Pronunciation')
    const isIpa = pronunciation.type === undefined || pronunciation.type === 'ipa'

    return hasReceivedPronunciationTag && isIpa
  })

  const selectedPronunciations = rpPronunciations.length > 0 ? rpPronunciations : pronunciations

  const ipaTexts = selectedPronunciations
    .map((pronunciation) => pronunciation.text)
    .filter((text): text is string => typeof text === 'string' && text.trim().length > 0)

  if (ipaTexts.length === 0) {
    return {
      value: null,
      reason:
        rpPronunciations.length > 0
          ? 'Received Pronunciation entry is missing IPA text.'
          : 'Dictionary entry is missing IPA text.',
    }
  }

  const stressPatterns = ipaTexts
    .map((ipaText) => parseDictionaryIpaStressPattern(ipaText))
    .filter((stresses): stresses is number[] => stresses !== null)

  if (stressPatterns.length === 0) {
    return {
      value: null,
      reason:
        rpPronunciations.length > 0
          ? 'Could not derive any stress patterns from the Received Pronunciation IPA text.'
          : 'Could not derive any stress patterns from the dictionary IPA text.',
    }
  }

  return {
    value: dedupeStressPatterns(stressPatterns),
    reason: null,
  }
}

export function combinePossibleStressPatterns(
  jsonStressPattern: number[] | null,
  dictionaryStressPatterns: number[][] | null,
  userStressPatterns: number[][] | null,
): PronunciationResolution<number[][]> {
  const patterns: number[][] = []

  if (jsonStressPattern) {
    patterns.push(jsonStressPattern)
  }

  if (Array.isArray(dictionaryStressPatterns)) {
    patterns.push(...dictionaryStressPatterns)
  }

  if (Array.isArray(userStressPatterns)) {
    patterns.push(...userStressPatterns)
  }

  const uniqueStressPatterns = dedupeStressPatterns(patterns)
  const augmentedStressPatterns = addMonosyllableAlternates(uniqueStressPatterns)

  if (augmentedStressPatterns.length === 0) {
    return {
      value: null,
      reason: 'No stress patterns available from JSON, dictionary, or user-defined sources.',
    }
  }

  return {
    value: augmentedStressPatterns,
    reason: null,
  }
}

export type MeterStressPatterns = {
  usual: string[]
  unusual: string[]
}

export function deriveMeterStressPatterns(
  stressPatterns: number[][] | null,
): PronunciationResolution<MeterStressPatterns> {
  if (!Array.isArray(stressPatterns) || stressPatterns.length === 0) {
    return {
      value: null,
      reason: 'No stress patterns available to convert into meter patterns.',
    }
  }

  const usual: string[] = []
  const unusual: string[] = []
  const seenUsual = new Set<string>()
  const seenUnusual = new Set<string>()

  for (const pattern of stressPatterns) {
    const usualPattern = mapStressPatternToTypicalPattern(pattern)

    if (!seenUsual.has(usualPattern)) {
      seenUsual.add(usualPattern)
      usual.push(usualPattern)
    }

    for (const unusualPattern of expandMeterStressPatternVariants(pattern)) {
      if (seenUsual.has(unusualPattern) || seenUnusual.has(unusualPattern)) {
        continue
      }

      seenUnusual.add(unusualPattern)
      unusual.push(unusualPattern)
    }
  }

  return {
    value: {
      usual,
      unusual,
    },
    reason: null,
  }
}

function normalizeWord(word: string) {
  return word.trim().replace(/’/g, "'").toUpperCase()
}

export function loadUserDefinedStressMap(): UserDefinedStressMap {
  if (typeof window === 'undefined') {
    return {}
  }

  const rawValue = window.localStorage.getItem(userDefinedStressStorageKey)

  if (!rawValue) {
    return {}
  }

  try {
    const parsed = JSON.parse(rawValue) as Record<string, unknown>
    const result: UserDefinedStressMap = {}

    for (const [word, patterns] of Object.entries(parsed)) {
      if (!Array.isArray(patterns)) {
        continue
      }

      const validPatterns = patterns
        .map((pattern) => parseStressPattern(pattern))
        .filter((pattern): pattern is number[] => pattern !== null)

      const uniquePatterns = dedupeStressPatterns(validPatterns)

      if (uniquePatterns.length > 0) {
        result[normalizeWord(word)] = uniquePatterns
      }
    }

    return result
  } catch {
    return {}
  }
}

export function saveUserDefinedStressMap(stressMap: UserDefinedStressMap) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(userDefinedStressStorageKey, JSON.stringify(stressMap))
}

export function normalizePronunciationWord(word: string) {
  return normalizeWord(word)
}

export function parseStressPatternInput(input: string) {
  const trimmed = input.trim()

  if (trimmed.length === 0 || !/^[012]+$/.test(trimmed)) {
    return null
  }

  return Array.from(trimmed, (char) => Number(char))
}

function dedupeStressPatterns(stressPatterns: number[][]) {
  const seen = new Set<string>()
  const uniqueStressPatterns: number[][] = []

  for (const pattern of stressPatterns) {
    const key = pattern.join(',')

    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    uniqueStressPatterns.push(pattern)
  }

  return uniqueStressPatterns
}

function areAllMonosyllableStressVariants(stressPatterns: number[][]) {
  if (stressPatterns.length === 0) {
    return false
  }

  return stressPatterns.every(
    (pattern) =>
      pattern.length === 1 &&
      (pattern[0] === 0 || pattern[0] === 1),
  )
}

function addMonosyllableAlternates(stressPatterns: number[][]) {
  const hasUnstressedMonosyllable = stressPatterns.some(
    (pattern) => pattern.length === 1 && pattern[0] === 0,
  )
  const hasStressedMonosyllable = stressPatterns.some(
    (pattern) => pattern.length === 1 && pattern[0] === 1,
  )

  if (!hasUnstressedMonosyllable && !hasStressedMonosyllable) {
    return stressPatterns
  }

  const nextPatterns = [...stressPatterns]

  if (hasUnstressedMonosyllable && !hasStressedMonosyllable) {
    nextPatterns.push([1])
  }

  if (hasStressedMonosyllable && !hasUnstressedMonosyllable) {
    nextPatterns.push([0])
  }

  return dedupeStressPatterns(nextPatterns)
}

function mapStressPatternToTypicalPattern(pattern: number[]) {
  return pattern.map((stress) => (stress === 0 ? 'x' : '/')).join('')
}

function expandMeterStressPatternVariants(pattern: number[]) {
  const variants: string[] = []
  const slots = new Array<string>(pattern.length)

  const visit = (index: number) => {
    if (index >= pattern.length) {
      variants.push(slots.join(''))
      return
    }

    const stress = pattern[index]

    if (stress === 2) {
      slots[index] = 'x'
      visit(index + 1)
      slots[index] = '/'
      visit(index + 1)
      return
    }

    slots[index] = stress === 1 ? '/' : 'x'
    visit(index + 1)
  }

  visit(0)

  return variants
}

function parseDictionaryIpaStressPattern(ipaText: string): number[] | null {
  const syllableStress: number[] = []
  let currentStress: number | null = null
  let currentHasContent = false
  let currentHasNucleus = false
  let currentInNucleusRun = false
  let pendingStress: number | null = null

  const pushCurrent = () => {
    if (!currentHasContent) {
      return
    }

    syllableStress.push(currentStress ?? 0)
    currentStress = null
    currentHasContent = false
    currentHasNucleus = false
    currentInNucleusRun = false
  }

  const startCurrent = () => {
    currentStress = pendingStress ?? 0
    pendingStress = null
    currentHasContent = true
    currentHasNucleus = false
    currentInNucleusRun = false
  }

  for (const char of Array.from(ipaText.normalize('NFKC'))) {
    if (char === 'ˈ') {
      pendingStress = 1
      continue
    }

    if (char === 'ˌ') {
      pendingStress = 2
      continue
    }

    if (isDictionarySyllableSeparator(char)) {
      pushCurrent()
      continue
    }

    if (isDictionaryIpaWrapper(char)) {
      continue
    }

    const isNucleus = isDictionaryIpaNucleus(char)

    if (!currentHasContent) {
      startCurrent()
    } else if (isNucleus && currentHasNucleus && !currentInNucleusRun) {
      pushCurrent()
      startCurrent()
    }

    currentHasContent = true

    if (isNucleus) {
      currentHasNucleus = true
      currentInNucleusRun = true
      continue
    }

    currentInNucleusRun = false
  }

  pushCurrent()

  return syllableStress.length > 0 ? syllableStress : null
}

function isDictionarySyllableSeparator(char: string) {
  return char === '.' || char === '·' || char === '‧' || /\s/u.test(char)
}

function isDictionaryIpaWrapper(char: string) {
  return char === '/' || char === '[' || char === ']' || char === '(' || char === ')'
}

function isDictionaryIpaNucleus(char: string) {
  return (
    /[aeiouɐɑɒæɓɔɘəɛɜɝɞɨɪɯɵøœʉʊʌʏyɶ]/u.test(char) ||
    char === '̩'
  )
}

function parseStressPattern(pattern: unknown) {
  if (!Array.isArray(pattern)) {
    return null
  }

  const values = pattern.map((value) => {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 2) {
      return null
    }

    return value
  })

  if (values.some((value) => value === null)) {
    return null
  }

  return values as number[]
}
