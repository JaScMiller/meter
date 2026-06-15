import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react'
import './App.css'

import { lookupDictionaryEntry, type DictionaryEntry } from './text_analysis/dictionary'
import { tokenizeText, type NlpWordToken } from './text_analysis/nlp'
import {
  combinePossibleStressPatterns,
  deriveMeterStressPatterns,
  lookupDictionaryPronunciation,
  lookupJsonPronunciation,
  loadUserDefinedStressMap,
  normalizePronunciationWord,
  parseStressPatternInput,
  saveUserDefinedStressMap,
  type PronunciationResolution,
  type UserDefinedStressMap,
} from './text_analysis/pronunciation'
import { normalizeNlpPos, type CanonicalPos } from './text_analysis/part_of_speech'
import {
  createStressPatternId,
  FREE_STRESS_PATTERN_ASSIGNMENT,
  loadStressPatternDefinitions,
  loadStressPatternAssignments,
  normalizeStressPatternName,
  normalizeStressPatternAssignmentValue,
  parseStressPatternInput as parseStressPatternSyntax,
  saveStressPatternDefinitions,
  saveStressPatternAssignments,
  type StressPatternAssignments,
  type StressPatternDefinition,
} from './text_analysis/stress_patterns'

type AnalysisStatus = 'idle' | 'queued' | 'running' | 'done' | 'error'

type RawTokenModel = NlpWordToken & {
  id: number
  canonicalPos: CanonicalPos
}

type TextUnitKind = 'word' | 'punctuation'

type TextUnitModel = {
  id: number
  kind: TextUnitKind
  text: string
  lookupText: string | null
  canonicalPos: CanonicalPos | null
  tokens: RawTokenModel[]
  pronunciations: {
    combinedPossibleStresses: PronunciationResolution<number[][]>
    jsonPronunciation: PronunciationResolution<number[]>
    dictionaryPronunciation: PronunciationResolution<number[][]>
  }
  dictionary: {
    status: AnalysisStatus
    entry: DictionaryEntry | null
  }
}

type LineAnalysis = {
  version: number
  status: AnalysisStatus
  tokenization: {
    status: AnalysisStatus
    tokens: RawTokenModel[]
  }
  units: {
    status: AnalysisStatus
    units: TextUnitModel[]
  }
  error: string | null
}

type LineModel = {
  id: number
  text: string
  analysis: LineAnalysis
}

type EditorSection = {
  id: number
  lines: LineModel[]
}

type SectionState = {
  section: EditorSection | null
  sectionNumber: number | null
  line: LineModel | null
}

type PersistedEditorLine = {
  id: number
  text: string
}

type PersistedEditorSection = {
  id: number
  lines: PersistedEditorLine[]
}

type PersistedEditorState = {
  sections: PersistedEditorSection[]
  activeSectionId: number | null
  activeLineNumber: number | null
}

const editorStateStorageKey = 'my-react-exp:editor-state:v1'

function createQueuedLineAnalysis(version: number): LineAnalysis {
  return {
    version,
    status: 'queued',
    tokenization: {
      status: 'queued',
      tokens: [],
    },
    units: {
      status: 'queued',
      units: [],
    },
    error: null,
  }
}

function createDefaultEditorSections() {
  return [
    createSectionFromTexts(1, 1, [
      "Shall I compare thee to a summer's day?",
      'Thou art more lovely and more temperate:',
      'Rough winds do shake the darling buds of May,',
    ]),
  ]
}

function createIdleLineAnalysis(version: number): LineAnalysis {
  return {
    version,
    status: 'idle',
    tokenization: {
      status: 'idle',
      tokens: [],
    },
    units: {
      status: 'idle',
      units: [],
    },
    error: null,
  }
}

function createRawTokenModel(id: number, token: NlpWordToken): RawTokenModel {
  return {
    id,
    value: token.value,
    pos: token.pos,
    canonicalPos: normalizeNlpPos(token.pos),
  }
}

function createTextUnitModel(
  id: number,
  kind: TextUnitKind,
  tokens: RawTokenModel[],
): TextUnitModel {
  const text = tokens.map((token) => token.value).join('')
  const headToken = tokens[0] ?? null
  const jsonPronunciation =
    kind === 'word'
      ? lookupJsonPronunciation(text)
      : {
          value: null,
          reason: 'Not a word unit.',
        }
  const combinedPossibleStresses = combinePossibleStressPatterns(jsonPronunciation.value, null, null)

  return {
    id,
    kind,
    text,
    lookupText: kind === 'word' ? headToken?.value ?? null : null,
    canonicalPos: kind === 'word' && headToken ? headToken.canonicalPos : null,
    tokens,
    pronunciations: {
      combinedPossibleStresses,
      jsonPronunciation,
      dictionaryPronunciation: {
        value: null,
        reason: 'Dictionary pronunciation not determined yet.',
      },
    },
    dictionary: {
      status: 'queued',
      entry: null,
    },
  }
}

function createRunningLineAnalysis(
  version: number,
  tokens: RawTokenModel[],
  units: TextUnitModel[],
): LineAnalysis {
  return {
    version,
    status: 'running',
    tokenization: {
      status: 'done',
      tokens,
    },
    units: {
      status: 'done',
      units,
    },
    error: null,
  }
}

function createDoneLineAnalysis(
  version: number,
  tokens: RawTokenModel[],
  units: TextUnitModel[],
): LineAnalysis {
  return {
    version,
    status: 'done',
    tokenization: {
      status: 'done',
      tokens,
    },
    units: {
      status: 'done',
      units,
    },
    error: null,
  }
}

function createLineModel(id: number, text: string, version = 1): LineModel {
  return {
    id,
    text,
    analysis:
      text.trim().length > 0 ? createQueuedLineAnalysis(version) : createIdleLineAnalysis(version),
  }
}

function createEmptySection(sectionId: number, lineId: number): EditorSection {
  return {
    id: sectionId,
    lines: [createLineModel(lineId, '')],
  }
}

function createSectionFromTexts(sectionId: number, startingLineId: number, texts: string[]) {
  return {
    id: sectionId,
    lines: texts.map((text, index) => createLineModel(startingLineId + index, text)),
  }
}

function createSectionFromPersistedLines(sectionId: number, lines: PersistedEditorLine[]) {
  return {
    id: sectionId,
    lines: lines.map((line) => createLineModel(line.id, line.text)),
  }
}

function getNextSectionId(sections: EditorSection[]) {
  return sections.reduce((nextId, section) => Math.max(nextId, section.id + 1), 1)
}

function getNextLineId(sections: EditorSection[]) {
  return sections.reduce(
    (nextId, section) =>
      Math.max(
        nextId,
        ...section.lines.map((line) => line.id + 1),
      ),
    1,
  )
}

function serializeEditorState(
  sections: EditorSection[],
  activeSectionId: number | null,
  activeLineNumber: number | null,
): PersistedEditorState {
  return {
    sections: sections.map((section) => ({
      id: section.id,
      lines: section.lines.map((line) => ({
        id: line.id,
        text: line.text,
      })),
    })),
    activeSectionId,
    activeLineNumber,
  }
}

function loadEditorState() {
  if (typeof window === 'undefined') {
    const sections = createDefaultEditorSections()

    return {
      sections,
      activeSectionId: sections[0]?.id ?? null,
      activeLineNumber: 1,
    }
  }

  const rawValue = window.localStorage.getItem(editorStateStorageKey)

  if (!rawValue) {
    const sections = createDefaultEditorSections()

    return {
      sections,
      activeSectionId: sections[0]?.id ?? null,
      activeLineNumber: 1,
    }
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<PersistedEditorState>
    const rawSections = Array.isArray(parsed.sections) ? parsed.sections : []
    const sections = rawSections
      .map((section) => {
        if (!section || typeof section !== 'object') {
          return null
        }

        const candidate = section as Partial<PersistedEditorSection>
        const sectionId = typeof candidate.id === 'number' ? candidate.id : null
        const rawLines = Array.isArray(candidate.lines) ? candidate.lines : []

        if (sectionId === null || rawLines.length === 0) {
          return null
        }

        const lines = rawLines
          .map((line) => {
            if (!line || typeof line !== 'object') {
              return null
            }

            const lineCandidate = line as Partial<PersistedEditorLine>

            if (typeof lineCandidate.id !== 'number' || typeof lineCandidate.text !== 'string') {
              return null
            }

            return {
              id: lineCandidate.id,
              text: lineCandidate.text,
            }
          })
          .filter((line): line is PersistedEditorLine => line !== null)

        if (lines.length === 0) {
          return null
        }

        return createSectionFromPersistedLines(sectionId, lines)
      })
      .filter((section): section is EditorSection => section !== null)

    if (sections.length === 0) {
      const fallbackSections = createDefaultEditorSections()

      return {
        sections: fallbackSections,
        activeSectionId: fallbackSections[0]?.id ?? null,
        activeLineNumber: 1,
      }
    }

    const activeSectionId =
      typeof parsed.activeSectionId === 'number' && sections.some((section) => section.id === parsed.activeSectionId)
        ? parsed.activeSectionId
        : sections[0]?.id ?? null

    const activeSection = sections.find((section) => section.id === activeSectionId) ?? null
    const activeLineNumber =
      typeof parsed.activeLineNumber === 'number' &&
      activeSection !== null &&
      parsed.activeLineNumber >= 1 &&
      parsed.activeLineNumber <= activeSection.lines.length
        ? parsed.activeLineNumber
        : 1

    return {
      sections,
      activeSectionId,
      activeLineNumber,
    }
  } catch {
    const sections = createDefaultEditorSections()

    return {
      sections,
      activeSectionId: sections[0]?.id ?? null,
      activeLineNumber: 1,
    }
  }
}

const initialEditorState = loadEditorState()

function joinSectionLines(lines: LineModel[]) {
  return lines.map((line) => line.text).join('\n')
}

function splitSectionText(value: string) {
  return value.split('\n')
}

function getCaretLineNumber(value: string, caretIndex: number) {
  return value.slice(0, caretIndex).split('\n').length
}

function updateLineById(
  sections: EditorSection[],
  lineId: number,
  updater: (line: LineModel) => LineModel,
): EditorSection[] {
  let sectionsChanged = false

  const nextSections = sections.map((section) => {
    let lineChanged = false

    const nextLines = section.lines.map((line) => {
      if (line.id !== lineId) {
        return line
      }

      const nextLine = updater(line)

      if (nextLine === line) {
        return line
      }

      lineChanged = true
      sectionsChanged = true
      return nextLine
    })

    if (!lineChanged) {
      return section
    }

    return {
      ...section,
      lines: nextLines,
    }
  })

  return sectionsChanged ? nextSections : sections
}

function reconcileSectionLines(
  existingLines: LineModel[],
  nextTexts: string[],
  nextLineIdRef: MutableRefObject<number>,
): LineModel[] {
  return nextTexts.map((text, index) => {
    const existing = existingLines[index]

    if (!existing) {
      const lineId = nextLineIdRef.current
      nextLineIdRef.current += 1
      return createLineModel(lineId, text)
    }

    if (existing.text === text) {
      return existing
    }

    return {
      ...existing,
      text,
      analysis: createQueuedLineAnalysis(existing.analysis.version + 1),
    }
  })
}

function isPunctuationToken(token: NlpWordToken) {
  return /^[\s.,!?;:)"'\]}]+$/.test(token.value)
}

function isApostropheSuffixToken(token: NlpWordToken) {
  return /^['’](?:s|d|ll|re|ve|m|t)$/.test(token.value) || /^n['’]t$/.test(token.value)
}

function buildTextUnits(rawTokens: RawTokenModel[]) {
  const units: TextUnitModel[] = []
  let nextUnitId = 1

  for (const token of rawTokens) {
    if (isApostropheSuffixToken(token) && units.length > 0 && units[units.length - 1].kind === 'word') {
      const previousUnit = units[units.length - 1]
      units[units.length - 1] = createTextUnitModel(
        previousUnit.id,
        'word',
        [...previousUnit.tokens, token],
      )
      continue
    }

    const kind: TextUnitKind = isPunctuationToken(token) ? 'punctuation' : 'word'
    units.push(createTextUnitModel(nextUnitId, kind, [token]))
    nextUnitId += 1
  }

  return units
}

function isOpeningPunctuationUnit(unit: TextUnitModel) {
  return /^[([{“‘"]+$/.test(unit.text)
}

function shouldInsertSpaceBeforeUnit(previousUnit: TextUnitModel | null, currentUnit: TextUnitModel) {
  if (previousUnit === null) {
    return false
  }

  if (currentUnit.kind === 'punctuation') {
    return false
  }

  if (previousUnit.kind === 'punctuation') {
    return !isOpeningPunctuationUnit(previousUnit)
  }

  return true
}

function getDictionaryPreview(entry: DictionaryEntry | null) {
  if (!entry) {
    return 'No dictionary entry found yet.'
  }

  const rawEntry = entry.rawEntry

  if (typeof rawEntry === 'string') {
    return rawEntry
  }

  if (rawEntry && typeof rawEntry === 'object') {
    const candidate = rawEntry as Record<string, unknown>
    const definitions = candidate.definitions

    if (Array.isArray(definitions) && definitions.length > 0) {
      const firstDefinition = definitions[0] as Record<string, unknown>

      if (typeof firstDefinition.definition === 'string') {
        return firstDefinition.definition
      }
    }

    try {
      return JSON.stringify(rawEntry, null, 2)
    } catch {
      return 'Dictionary entry available, but it could not be formatted.'
    }
  }

  return 'Dictionary entry available.'
}

function resolvePatternAssignmentValue(
  patternId: string | null,
  patternDefinitions: StressPatternDefinition[],
) {
  const validPatternIds = new Set(patternDefinitions.map((pattern) => pattern.id))
  return normalizeStressPatternAssignmentValue(patternId, validPatternIds)
}

type MeterStressResolution = {
  value: string | null
  reason: string | null
  severity: MeterStressSeverity
}

type MeterStressSeverity = 'neutral' | 'good' | 'warning' | 'alert'

function getWordSyllableCount(unit: TextUnitModel) {
  if (unit.kind !== 'word') {
    return null
  }

  const stressPatterns = unit.pronunciations.combinedPossibleStresses.value

  if (!Array.isArray(stressPatterns) || stressPatterns.length === 0) {
    return null
  }

  return Math.min(...stressPatterns.map((pattern) => pattern.length))
}

function splitMeterPatternTokens(pattern: string) {
  return pattern.trim().split(/\s+/).filter(Boolean)
}

function compactMeterPatternTokens(pattern: string) {
  return splitMeterPatternTokens(pattern)
    .filter((token) => token !== '|')
    .join('')
}

function stripMeterFootSeparators(pattern: string) {
  return splitMeterPatternTokens(pattern)
    .filter((token) => token !== '|')
    .join('')
}

function doesMeterPatternMatch(expectedPattern: string, actualPattern: string) {
  if (expectedPattern.length !== actualPattern.length) {
    return false
  }

  return Array.from(expectedPattern).every((token, index) => token === '?' || token === actualPattern[index])
}

function selectWordStressIndicatorPattern(
  unit: TextUnitModel,
  meterStressResolution: MeterStressResolution,
) {
  if (unit.kind !== 'word') {
    return null
  }

  const meterStressPatterns = deriveMeterStressPatterns(unit.pronunciations.combinedPossibleStresses.value)
  const usualPatterns = meterStressPatterns.value?.usual ?? []
  const unusualPatterns = meterStressPatterns.value?.unusual ?? []
  const meterSlice = meterStressResolution.value ? stripMeterFootSeparators(meterStressResolution.value) : null

  if (meterSlice && /^[x/]+$/.test(meterSlice)) {
    const matchedUsualPattern = usualPatterns.find((pattern) => doesMeterPatternMatch(pattern, meterSlice))

    if (matchedUsualPattern) {
      return meterSlice
    }

    const matchedUnusualPattern = unusualPatterns.find((pattern) => doesMeterPatternMatch(pattern, meterSlice))

    if (matchedUnusualPattern) {
      return meterSlice
    }
  }

  return usualPatterns[0] ?? unusualPatterns[0] ?? meterSlice
}

function getStressIndicatorDots(pattern: string | null) {
  if (!pattern) {
    return []
  }

  return stripMeterFootSeparators(pattern)
    .split('')
    .filter((token) => token === '/' || token === 'x')
    .map((token) => token === '/')
}

function getMeterPatternSyllableCount(pattern: string) {
  return splitMeterPatternTokens(pattern).filter((token) => token !== '|').length
}

function getMeterStressSeverityRank(severity: MeterStressSeverity) {
  switch (severity) {
    case 'alert':
      return 3
    case 'warning':
      return 2
    case 'good':
      return 1
    case 'neutral':
    default:
      return 0
  }
}

function getMoreSevereMeterStress(
  currentSeverity: MeterStressSeverity,
  nextSeverity: MeterStressSeverity,
) {
  return getMeterStressSeverityRank(nextSeverity) > getMeterStressSeverityRank(currentSeverity)
    ? nextSeverity
    : currentSeverity
}

function resolveMeterStressSlice(
  pattern: string,
  startSyllableIndex: number,
  syllableCount: number,
): MeterStressResolution {
  const tokens = splitMeterPatternTokens(pattern)
  const syllableTokenIndices = tokens
    .map((token, index) => (token === '|' ? null : index))
    .filter((index): index is number => index !== null)

  if (tokens.length === 0 || syllableTokenIndices.length === 0) {
    return {
      value: null,
      reason: 'The assigned meter has no syllables.',
      severity: 'neutral',
    }
  }

  if (syllableCount <= 0) {
    return {
      value: null,
      reason: 'The selected word could not be measured in syllables.',
      severity: 'neutral',
    }
  }

  const startSyllableTokenIndex = syllableTokenIndices[startSyllableIndex]
  const endSyllableTokenIndex = syllableTokenIndices[startSyllableIndex + syllableCount - 1]

  if (startSyllableTokenIndex === undefined || endSyllableTokenIndex === undefined) {
    return {
      value: null,
      reason: 'The assigned meter is shorter than the selected word position.',
      severity: 'neutral',
    }
  }

  const sliceTokens = tokens.slice(startSyllableTokenIndex, endSyllableTokenIndex + 1)

  if (startSyllableTokenIndex > 0 && tokens[startSyllableTokenIndex - 1] === '|') {
    sliceTokens.unshift('|')
  }

  if (endSyllableTokenIndex + 1 < tokens.length && tokens[endSyllableTokenIndex + 1] === '|') {
    sliceTokens.push('|')
  }

  return {
    value: sliceTokens.join(' '),
    reason: null,
    severity: 'neutral',
  }
}

function resolveMeterStressForWord(
  selectedUnit: TextUnitModel | null,
  selectedUnitIndex: number | null,
  visibleUnits: TextUnitModel[],
  activeEffectiveAssignment: string | null,
  activeEffectivePattern: StressPatternDefinition | null,
): MeterStressResolution {
  if (!selectedUnit || selectedUnit.kind !== 'word' || selectedUnitIndex === null) {
    return {
      value: null,
      reason: null,
      severity: 'neutral',
    }
  }

  if (activeEffectiveAssignment === FREE_STRESS_PATTERN_ASSIGNMENT) {
    return {
      value: 'free',
      reason: null,
      severity: 'neutral',
    }
  }

  if (activeEffectiveAssignment === null || activeEffectivePattern === null) {
    return {
      value: 'none',
      reason: null,
      severity: 'neutral',
    }
  }

  let syllableOffset = 0

  for (let index = 0; index < selectedUnitIndex; index += 1) {
    const unit = visibleUnits[index]

    if (unit.kind !== 'word') {
      continue
    }

    const syllableCount = getWordSyllableCount(unit)

    if (syllableCount === null) {
      return {
        value: null,
        reason: `Could not count syllables for "${unit.text}".`,
        severity: 'alert',
      }
    }

    syllableOffset += syllableCount
  }

  const selectedWordSyllables = getWordSyllableCount(selectedUnit)

  if (selectedWordSyllables === null) {
    return {
      value: null,
      reason: `Could not count syllables for "${selectedUnit.text}".`,
      severity: 'alert',
    }
  }

  const sliceResolution = resolveMeterStressSlice(
    activeEffectivePattern.pattern,
    syllableOffset,
    selectedWordSyllables,
  )

  if (sliceResolution.value === null) {
    return {
      ...sliceResolution,
      severity: 'alert',
    }
  }

  const meterStressPatterns = deriveMeterStressPatterns(selectedUnit.pronunciations.combinedPossibleStresses.value)
  const compactSlice = compactMeterPatternTokens(sliceResolution.value)
  const usualStressPatterns = meterStressPatterns.value?.usual ?? []
  const unusualStressPatterns = meterStressPatterns.value?.unusual ?? []

  if (usualStressPatterns.some((pattern) => doesMeterPatternMatch(compactSlice, pattern))) {
    return {
      ...sliceResolution,
      severity: 'good',
    }
  }

  if (unusualStressPatterns.some((pattern) => doesMeterPatternMatch(compactSlice, pattern))) {
    return {
      ...sliceResolution,
      severity: 'warning',
    }
  }

  return {
    ...sliceResolution,
    severity: 'alert',
  }
}

function resolveLineMeterSeverity(
  units: TextUnitModel[],
  unitsStatus: AnalysisStatus,
  activeEffectiveAssignment: string | null,
  activeEffectivePattern: StressPatternDefinition | null,
) {
  if (unitsStatus !== 'done') {
    return 'neutral' as MeterStressSeverity
  }

  if (activeEffectiveAssignment === FREE_STRESS_PATTERN_ASSIGNMENT) {
    return 'neutral' as MeterStressSeverity
  }

  if (activeEffectiveAssignment === null || activeEffectivePattern === null) {
    return 'neutral' as MeterStressSeverity
  }

  const expectedSyllableCount = getMeterPatternSyllableCount(activeEffectivePattern.pattern)

  let totalSyllableCount = 0

  for (const unit of units) {
    if (unit.kind !== 'word') {
      continue
    }

    const syllableCount = getWordSyllableCount(unit)

    if (syllableCount === null) {
      return 'alert' as MeterStressSeverity
    }

    totalSyllableCount += syllableCount
  }

  if (totalSyllableCount < expectedSyllableCount) {
    return 'alert' as MeterStressSeverity
  }

  if (totalSyllableCount > expectedSyllableCount) {
    return 'alert' as MeterStressSeverity
  }

  let lineSeverity: MeterStressSeverity = 'good'

  units.forEach((unit, index) => {
    if (unit.kind !== 'word') {
      return
    }

    const wordAssessment = resolveMeterStressForWord(
      unit,
      index,
      units,
      activeEffectiveAssignment,
      activeEffectivePattern,
    )

    lineSeverity = getMoreSevereMeterStress(lineSeverity, wordAssessment.severity)
  })

  return lineSeverity
}

function getActiveSectionState(
  sections: EditorSection[],
  activeSectionId: number | null,
  activeLineNumber: number | null,
): SectionState {
  if (activeSectionId === null || activeLineNumber === null) {
    return {
      section: null,
      sectionNumber: null,
      line: null,
    }
  }

  const sectionIndex = sections.findIndex((section) => section.id === activeSectionId)

  if (sectionIndex < 0) {
    return {
      section: null,
      sectionNumber: null,
      line: null,
    }
  }

  const section = sections[sectionIndex]
  const line = section.lines[activeLineNumber - 1] ?? null

  return {
    section,
    sectionNumber: sectionIndex + 1,
    line,
  }
}

function EditorCard({
  section,
  sectionNumber,
  patternDefinitions,
  assignedPatternId,
  lineMeterSeverityById,
  onChange,
  onDelete,
  onCaretChange,
  onPatternChange,
  registerRef,
  focusRequested,
}: {
  section: EditorSection
  sectionNumber: number
  patternDefinitions: StressPatternDefinition[]
  assignedPatternId: string | null
  lineMeterSeverityById: Map<number, MeterStressSeverity>
  onChange: (id: number, value: string) => void
  onDelete: (id: number) => void
  onCaretChange: (sectionId: number, lineNumber: number) => void
  onPatternChange: (id: number, patternId: string | null) => void
  registerRef: (id: number, node: HTMLTextAreaElement | null) => void
  focusRequested: boolean
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  useLayoutEffect(() => {
    const element = textareaRef.current

    if (!element) {
      return
    }

    element.style.height = '0px'
    element.style.height = `${element.scrollHeight}px`
  }, [section.lines])

  useEffect(() => {
    if (!focusRequested) {
      return
    }

    textareaRef.current?.focus()
  }, [focusRequested])

  const textareaValue = joinSectionLines(section.lines)

  const reportCaretPosition = () => {
    const element = textareaRef.current

    if (!element) {
      return
    }

    onCaretChange(section.id, getCaretLineNumber(textareaValue, element.selectionStart))
  }

  return (
    <section className="editor-card">
      <div className="editor-topbar">
        <div className="editor-topbar-left">
          <div className="editor-section-badge">Section {sectionNumber}</div>

          <PatternAssignmentSelect
            label="Section"
            value={assignedPatternId}
            patternDefinitions={patternDefinitions}
            onChange={(patternId) => onPatternChange(section.id, patternId)}
            className="pattern-assignment--inline"
          />
        </div>

        <button
          className="editor-delete"
          type="button"
          onClick={() => onDelete(section.id)}
          aria-label={`Delete section ${sectionNumber}`}
        >
          ×
        </button>
      </div>

      <div className="editor-body">
        <div className="editor-gutter" aria-hidden="true">
          {section.lines.map((line, index) => (
            <span key={line.id} className="editor-line-row">
              <span
                className={`editor-line-marker editor-line-marker--${
                  lineMeterSeverityById.get(line.id) ?? 'neutral'
                }`}
              />
              <span className="editor-line-number">{index + 1}</span>
            </span>
          ))}
        </div>

        <textarea
          ref={(node) => {
            textareaRef.current = node
            registerRef(section.id, node)
          }}
          className="editor-input"
          value={textareaValue}
          onChange={(event) => onChange(section.id, event.target.value)}
          rows={1}
          wrap="off"
          spellCheck={false}
          aria-label={`Text section ${sectionNumber}`}
          placeholder="Start typing..."
          onSelect={reportCaretPosition}
          onKeyUp={reportCaretPosition}
          onMouseUp={reportCaretPosition}
          onFocus={reportCaretPosition}
        />
      </div>
    </section>
  )
}

function PatternAssignmentSelect({
  label,
  value,
  patternDefinitions,
  onChange,
  className,
}: {
  label: string
  value: string | null
  patternDefinitions: StressPatternDefinition[]
  onChange: (patternId: string | null) => void
  className?: string
}) {
  return (
    <label className={`pattern-assignment${className ? ` ${className}` : ''}`}>
      <span className="pattern-assignment-label">{label}</span>
      <select
        className="pattern-assignment-select"
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
      >
        <option value="">None</option>
        <option value={FREE_STRESS_PATTERN_ASSIGNMENT}>Free</option>
        {patternDefinitions.map((pattern) => (
          <option key={pattern.id} value={pattern.id}>
            {pattern.name}
          </option>
        ))}
      </select>
    </label>
  )
}

function App() {
  const [sections, setSections] = useState<EditorSection[]>(() => initialEditorState.sections)
  const [focusSectionId, setFocusSectionId] = useState<number | null>(null)
  const [activeSectionId, setActiveSectionId] = useState<number | null>(
    initialEditorState.activeSectionId,
  )
  const [activeLineNumber, setActiveLineNumber] = useState<number | null>(
    initialEditorState.activeLineNumber,
  )
  const [selectedUnitIndex, setSelectedUnitIndex] = useState<number | null>(null)
  const [userDefinedStressMap, setUserDefinedStressMap] = useState<UserDefinedStressMap>(() =>
    loadUserDefinedStressMap(),
  )
  const [stressPatternDefinitions, setStressPatternDefinitions] = useState<StressPatternDefinition[]>(
    () => loadStressPatternDefinitions(),
  )
  const [stressPatternAssignments, setStressPatternAssignments] = useState<StressPatternAssignments>(
    () => loadStressPatternAssignments(),
  )
  const nextSectionIdRef = useRef(getNextSectionId(initialEditorState.sections))
  const nextLineIdRef = useRef(getNextLineId(initialEditorState.sections))
  const textareaRefs = useRef(new Map<number, HTMLTextAreaElement | null>())
  const scheduledAnalysesRef = useRef(
    new Map<number, { timeoutId: number; version: number }>(),
  )

  const persistedEditorStateJson = JSON.stringify(
    serializeEditorState(sections, activeSectionId, activeLineNumber),
  )

  useEffect(() => {
    window.localStorage.setItem(editorStateStorageKey, persistedEditorStateJson)
  }, [persistedEditorStateJson])

  useEffect(() => {
    nextSectionIdRef.current = getNextSectionId(sections)
    nextLineIdRef.current = getNextLineId(sections)
  }, [sections])

  useEffect(() => {
    saveUserDefinedStressMap(userDefinedStressMap)
  }, [userDefinedStressMap])

  useEffect(() => {
    setSections((current) => {
      let sectionsChanged = false

      const nextSections = current.map((section) => {
        let sectionChanged = false

        const nextLines = section.lines.map((line) => {
          if (line.analysis.units.status !== 'done') {
            return line
          }

          let lineChanged = false

          const nextUnits = line.analysis.units.units.map((unit) => {
            if (unit.kind !== 'word') {
              return unit
            }

            const unitWordKey = normalizePronunciationWord(unit.text)
            const nextCombinedPossibleStresses = combinePossibleStressPatterns(
              unit.pronunciations.jsonPronunciation.value,
              unit.pronunciations.dictionaryPronunciation.value,
              userDefinedStressMap[unitWordKey] ?? [],
            )

            if (
              unit.pronunciations.combinedPossibleStresses.value === nextCombinedPossibleStresses.value &&
              unit.pronunciations.combinedPossibleStresses.reason === nextCombinedPossibleStresses.reason
            ) {
              return unit
            }

            lineChanged = true

            return {
              ...unit,
              pronunciations: {
                ...unit.pronunciations,
                combinedPossibleStresses: nextCombinedPossibleStresses,
              },
            }
          })

          if (!lineChanged) {
            return line
          }

          sectionChanged = true
          sectionsChanged = true

          return {
            ...line,
            analysis: {
              ...line.analysis,
              units: {
                ...line.analysis.units,
                units: nextUnits,
              },
            },
          }
        })

        if (!sectionChanged) {
          return section
        }

        return {
          ...section,
          lines: nextLines,
        }
      })

      return sectionsChanged ? nextSections : current
    })
  }, [userDefinedStressMap])

  useEffect(() => {
    saveStressPatternDefinitions(stressPatternDefinitions)
  }, [stressPatternDefinitions])

  useEffect(() => {
    const validPatternIds = new Set(stressPatternDefinitions.map((pattern) => pattern.id))
    const liveSectionIds = new Set(sections.map((section) => String(section.id)))
    const liveLineIds = new Set(
      sections.flatMap((section) => section.lines.map((line) => String(line.id))),
    )

    setStressPatternAssignments((current) => {
      const nextDefaultPatternId = normalizeStressPatternAssignmentValue(
        current.defaultPatternId,
        validPatternIds,
      )

      const nextSectionPatternIds: Record<string, string> = {}
      const nextLinePatternIds: Record<string, string> = {}

      for (const [sectionId, patternId] of Object.entries(current.sectionPatternIds)) {
        if (!liveSectionIds.has(sectionId)) {
          continue
        }

        const normalizedPatternId = normalizeStressPatternAssignmentValue(patternId, validPatternIds)

        if (normalizedPatternId === null) {
          continue
        }

        nextSectionPatternIds[sectionId] = normalizedPatternId
      }

      for (const [lineId, patternId] of Object.entries(current.linePatternIds)) {
        if (!liveLineIds.has(lineId)) {
          continue
        }

        const normalizedPatternId = normalizeStressPatternAssignmentValue(patternId, validPatternIds)

        if (normalizedPatternId === null) {
          continue
        }

        nextLinePatternIds[lineId] = normalizedPatternId
      }

      const sameDefault = nextDefaultPatternId === current.defaultPatternId
      const sameSections =
        Object.keys(nextSectionPatternIds).length === Object.keys(current.sectionPatternIds).length &&
        Object.entries(nextSectionPatternIds).every(
          ([key, patternId]) => current.sectionPatternIds[key] === patternId,
        )
      const sameLines =
        Object.keys(nextLinePatternIds).length === Object.keys(current.linePatternIds).length &&
        Object.entries(nextLinePatternIds).every(([key, patternId]) => current.linePatternIds[key] === patternId)

      if (sameDefault && sameSections && sameLines) {
        return current
      }

      return {
        defaultPatternId: nextDefaultPatternId,
        sectionPatternIds: nextSectionPatternIds,
        linePatternIds: nextLinePatternIds,
      }
    })
  }, [sections, stressPatternDefinitions])

  useEffect(() => {
    saveStressPatternAssignments(stressPatternAssignments)
  }, [stressPatternAssignments])

  const registerRef = (id: number, node: HTMLTextAreaElement | null) => {
    if (node) {
      textareaRefs.current.set(id, node)
      return
    }

    textareaRefs.current.delete(id)
  }

  const addSection = () => {
    const sectionId = nextSectionIdRef.current
    nextSectionIdRef.current += 1

    const lineId = nextLineIdRef.current
    nextLineIdRef.current += 1

    setSections((current) => [...current, createEmptySection(sectionId, lineId)])
    setFocusSectionId(sectionId)
    setActiveSectionId(sectionId)
    setActiveLineNumber(1)
  }

  const updateSection = (id: number, value: string) => {
    const nextTexts = splitSectionText(value)

    setSections((current) =>
      current.map((section) =>
        section.id === id
          ? {
              ...section,
              lines: reconcileSectionLines(section.lines, nextTexts, nextLineIdRef),
            }
          : section,
      ),
    )
  }

  const handleCaretChange = (sectionId: number, lineNumber: number) => {
    setActiveSectionId(sectionId)
    setActiveLineNumber(lineNumber)
  }

  const deleteSection = (id: number) => {
    const currentIndex = sections.findIndex((section) => section.id === id)
    const nextSections = sections.filter((section) => section.id !== id)
    const nextFocus = nextSections[currentIndex] ?? nextSections[currentIndex - 1] ?? null

    setSections(nextSections)
    setFocusSectionId(nextFocus?.id ?? null)

    if (activeSectionId === id) {
      const fallbackSection = nextFocus ?? nextSections[0] ?? null

      setActiveSectionId(fallbackSection?.id ?? null)
      setActiveLineNumber(fallbackSection ? 1 : null)
    }
  }

  const setDefaultPatternId = (patternId: string | null) => {
    setStressPatternAssignments((current) => {
      if (current.defaultPatternId === patternId) {
        return current
      }

      return {
        ...current,
        defaultPatternId: patternId,
      }
    })
  }

  const setSectionPatternId = (sectionId: number, patternId: string | null) => {
    const key = String(sectionId)

    setStressPatternAssignments((current) => {
      if ((current.sectionPatternIds[key] ?? null) === patternId) {
        return current
      }

      const nextSectionPatternIds = { ...current.sectionPatternIds }

      if (patternId === null) {
        delete nextSectionPatternIds[key]
      } else {
        nextSectionPatternIds[key] = patternId
      }

      return {
        ...current,
        sectionPatternIds: nextSectionPatternIds,
      }
    })
  }

  const setLinePatternId = (lineId: number, patternId: string | null) => {
    const key = String(lineId)

    setStressPatternAssignments((current) => {
      if ((current.linePatternIds[key] ?? null) === patternId) {
        return current
      }

      const nextLinePatternIds = { ...current.linePatternIds }

      if (patternId === null) {
        delete nextLinePatternIds[key]
      } else {
        nextLinePatternIds[key] = patternId
      }

      return {
        ...current,
        linePatternIds: nextLinePatternIds,
      }
    })
  }

  useEffect(() => {
    const scheduledAnalyses = scheduledAnalysesRef.current
    const liveLineIds = new Set<number>()

    const updateAnalysisForLine = (
      lineId: number,
      version: number,
      updater: (analysis: LineAnalysis) => LineAnalysis,
    ) => {
      setSections((current) =>
        updateLineById(current, lineId, (line) => {
          if (line.analysis.version !== version) {
            return line
          }

          return {
            ...line,
            analysis: updater(line.analysis),
          }
        }),
      )
    }

    const updateUnitForLine = (
      lineId: number,
      version: number,
      unitId: number,
      updater: (unit: TextUnitModel) => TextUnitModel,
    ) => {
      setSections((current) =>
        updateLineById(current, lineId, (line) => {
          if (line.analysis.version !== version) {
            return line
          }

          return {
            ...line,
            analysis: {
              ...line.analysis,
              units: {
                ...line.analysis.units,
                units: line.analysis.units.units.map((unit) =>
                  unit.id === unitId ? updater(unit) : unit,
                ),
              },
            },
          }
        }),
      )
    }

    const runLineAnalysis = async (lineId: number, version: number, text: string) => {
      try {
        const rawTokens = tokenizeText(text).map((token, index) => createRawTokenModel(index + 1, token))
        const units = buildTextUnits(rawTokens)

        updateAnalysisForLine(lineId, version, (analysis) => {
          if (analysis.status !== 'queued') {
            return analysis
          }

          return createRunningLineAnalysis(version, rawTokens, units)
        })

        if (units.length === 0) {
          updateAnalysisForLine(lineId, version, (analysis) => {
            if (analysis.status !== 'running') {
              return analysis
            }

            return createDoneLineAnalysis(version, rawTokens, units)
          })

          return
        }

        for (const unit of units) {
          if (unit.kind === 'punctuation' || unit.lookupText === null || unit.lookupText.trim().length === 0) {
            updateUnitForLine(lineId, version, unit.id, (currentUnit) => ({
              ...currentUnit,
              dictionary: {
                status: 'done',
                entry: null,
              },
              pronunciations: {
                ...currentUnit.pronunciations,
                dictionaryPronunciation: {
                  value: null,
                  reason:
                    unit.kind === 'punctuation'
                      ? 'Not a word unit.'
                      : 'No lookup text available for dictionary pronunciation.',
                },
                combinedPossibleStresses: combinePossibleStressPatterns(
                  currentUnit.pronunciations.jsonPronunciation.value,
                  null,
                  null,
                ),
              },
            }))
            continue
          }

          updateUnitForLine(lineId, version, unit.id, (currentUnit) => ({
            ...currentUnit,
            dictionary: {
              status: 'running',
              entry: null,
            },
            pronunciations: {
              ...currentUnit.pronunciations,
              dictionaryPronunciation: {
                value: null,
                reason: 'Dictionary pronunciation is being looked up.',
              },
              combinedPossibleStresses: combinePossibleStressPatterns(
                currentUnit.pronunciations.jsonPronunciation.value,
                currentUnit.pronunciations.dictionaryPronunciation.value,
                null,
              ),
            },
          }))

          const entry = await lookupDictionaryEntry(unit.lookupText, unit.canonicalPos ?? unit.tokens[0].canonicalPos)
          const dictionaryPronunciation = lookupDictionaryPronunciation(
            entry,
            unit.lookupText,
            unit.text,
          )

          updateUnitForLine(lineId, version, unit.id, (currentUnit) => ({
            ...currentUnit,
            dictionary: {
              status: 'done',
              entry,
            },
            pronunciations: {
              ...currentUnit.pronunciations,
              dictionaryPronunciation,
              combinedPossibleStresses: combinePossibleStressPatterns(
                currentUnit.pronunciations.jsonPronunciation.value,
                dictionaryPronunciation.value,
                null,
              ),
            },
          }))
        }

        updateAnalysisForLine(lineId, version, (analysis) => {
          if (analysis.status !== 'running') {
            return analysis
          }

          return {
            version,
            status: 'done',
            tokenization: {
              status: 'done',
              tokens: analysis.tokenization.tokens,
            },
            units: {
              status: 'done',
              units: analysis.units.units,
            },
            error: null,
          }
        })
      } catch (error) {
        updateAnalysisForLine(lineId, version, (analysis) => {
          if (analysis.status !== 'running' && analysis.status !== 'queued') {
            return analysis
          }

          return {
            version,
            status: 'error',
            tokenization: {
              status: 'error',
              tokens: analysis.tokenization.tokens,
            },
            units: {
              status: 'error',
              units: analysis.units.units,
            },
            error: error instanceof Error ? error.message : String(error),
          }
        })
      }
    }

    for (const section of sections) {
      for (const line of section.lines) {
        liveLineIds.add(line.id)

        const scheduled = scheduledAnalyses.get(line.id)

        if (line.analysis.status !== 'queued') {
          if (scheduled) {
            clearTimeout(scheduled.timeoutId)
            scheduledAnalyses.delete(line.id)
          }

          continue
        }

        if (scheduled?.version === line.analysis.version) {
          continue
        }

        if (scheduled) {
          clearTimeout(scheduled.timeoutId)
          scheduledAnalyses.delete(line.id)
        }

        const timeoutId = window.setTimeout(() => {
          scheduledAnalyses.delete(line.id)
          void runLineAnalysis(line.id, line.analysis.version, line.text)
        }, 250)

        scheduledAnalyses.set(line.id, {
          timeoutId,
          version: line.analysis.version,
        })
      }
    }

    for (const [lineId, scheduled] of scheduledAnalyses) {
      if (liveLineIds.has(lineId)) {
        continue
      }

      clearTimeout(scheduled.timeoutId)
      scheduledAnalyses.delete(lineId)
    }
  }, [sections])

  const activeState = getActiveSectionState(sections, activeSectionId, activeLineNumber)
  const activeSectionNumber = activeState.sectionNumber
  const activeLine = activeState.line
  const activeLineId = activeLine?.id ?? null
  const hasActiveCaret = activeSectionNumber !== null && activeLineNumber !== null && activeLine !== null
  const isDebouncing = activeLine?.analysis.status === 'queued'
  const units = activeLine?.analysis.units ?? null
  const visibleUnits = units?.status === 'done' ? units.units : []
  const selectedUnit =
    selectedUnitIndex !== null && selectedUnitIndex < visibleUnits.length
      ? visibleUnits[selectedUnitIndex]
      : visibleUnits[0] ?? null
  const resolvedSelectedUnitIndex = selectedUnitIndex ?? (selectedUnit ? 0 : null)
  const selectedUnitWordKey =
    selectedUnit?.kind === 'word' ? normalizePronunciationWord(selectedUnit.text) : null
  const selectedUserDefinedStressPatterns =
    selectedUnitWordKey !== null ? userDefinedStressMap[selectedUnitWordKey] ?? [] : []
  const customStressEntries = Object.entries(userDefinedStressMap).sort(([left], [right]) =>
    left.localeCompare(right),
  )
  const customStressCount = customStressEntries.reduce((sum, [, patterns]) => sum + patterns.length, 0)
  const combinedPossibleStresses = selectedUnit
    ? combinePossibleStressPatterns(
        selectedUnit.pronunciations.jsonPronunciation.value,
        selectedUnit.pronunciations.dictionaryPronunciation.value,
        selectedUserDefinedStressPatterns,
      )
    : {
      value: null,
      reason: 'No active unit selected.',
    }
  const meterStressPatterns = deriveMeterStressPatterns(combinedPossibleStresses.value)
  const typicalStressPatterns = meterStressPatterns.value?.usual ?? null
  const otherStressPatterns = meterStressPatterns.value?.unusual ?? null
  const activeSectionPatternId = activeState.section
    ? resolvePatternAssignmentValue(
        stressPatternAssignments.sectionPatternIds[String(activeState.section.id)] ?? null,
        stressPatternDefinitions,
      )
    : null
  const activeLinePatternId =
    activeLineId !== null
      ? resolvePatternAssignmentValue(
          stressPatternAssignments.linePatternIds[String(activeLineId)] ?? null,
          stressPatternDefinitions,
        )
      : null
  const defaultPatternId = resolvePatternAssignmentValue(
    stressPatternAssignments.defaultPatternId,
    stressPatternDefinitions,
  )
  const activeEffectiveAssignment = activeLinePatternId ?? activeSectionPatternId ?? defaultPatternId
  const activeEffectivePattern =
    activeEffectiveAssignment === FREE_STRESS_PATTERN_ASSIGNMENT
      ? null
      : stressPatternDefinitions.find((pattern) => pattern.id === activeEffectiveAssignment) ?? null
  const visibleUnitMeterStressAssessments = visibleUnits.map((unit, index) =>
    resolveMeterStressForWord(unit, index, visibleUnits, activeEffectiveAssignment, activeEffectivePattern),
  )
  const visibleUnitStressIndicatorPatterns = visibleUnits.map((unit, index) =>
    selectWordStressIndicatorPattern(
      unit,
      visibleUnitMeterStressAssessments[index] ?? {
        value: null,
        reason: null,
        severity: 'neutral' as MeterStressSeverity,
      },
    ),
  )
  const selectedUnitMeterStress =
    resolvedSelectedUnitIndex !== null
      ? visibleUnitMeterStressAssessments[resolvedSelectedUnitIndex] ?? {
          value: null,
          reason: null,
          severity: 'neutral' as MeterStressSeverity,
        }
      : {
          value: null,
          reason: null,
          severity: 'neutral' as MeterStressSeverity,
        }

  const lineMeterSeverityById = new Map<number, MeterStressSeverity>()

  sections.forEach((section) => {
    const sectionPatternId = resolvePatternAssignmentValue(
      stressPatternAssignments.sectionPatternIds[String(section.id)] ?? null,
      stressPatternDefinitions,
    )

    section.lines.forEach((line) => {
      const linePatternId = resolvePatternAssignmentValue(
        stressPatternAssignments.linePatternIds[String(line.id)] ?? null,
        stressPatternDefinitions,
      )
      const activeLineAssignment = linePatternId ?? sectionPatternId ?? defaultPatternId
      const activeLinePattern =
        activeLineAssignment === FREE_STRESS_PATTERN_ASSIGNMENT
          ? null
          : stressPatternDefinitions.find((pattern) => pattern.id === activeLineAssignment) ?? null

      lineMeterSeverityById.set(
        line.id,
        resolveLineMeterSeverity(
          line.analysis.units.units,
          line.analysis.units.status,
          activeLineAssignment,
          activeLinePattern,
        ),
      )
    })
  })

  const addUserDefinedStress = () => {
    if (!selectedUnit || selectedUnit.kind !== 'word' || selectedUnitWordKey === null) {
      window.alert('Select a word before adding a stress pattern.')
      return
    }

    const input = window.prompt(
      'Enter a stress pattern using only 0, 1, and 2.\n1 = primary stress, 2 = secondary stress, 0 = no stress.\nFor example: 01212',
    )

    if (input === null) {
      return
    }

    const pattern = parseStressPatternInput(input)

    if (!pattern) {
      window.alert('Please enter a valid pattern using only 0, 1, and 2, where 1 = primary, 2 = secondary, and 0 = none.')
      return
    }

    const existingPatterns = userDefinedStressMap[selectedUnitWordKey] ?? []
    const isDuplicate = existingPatterns.some(
      (candidate) =>
        candidate.length === pattern.length && candidate.every((value, index) => value === pattern[index]),
    )

    if (isDuplicate) {
      window.alert('That stress pattern already exists for this word.')
      return
    }

    setUserDefinedStressMap((current) => ({
      ...current,
      [selectedUnitWordKey]: [...existingPatterns, pattern],
    }))
  }

  const deleteUserDefinedStress = (wordKey: string, patternToDelete: number[]) => {
    setUserDefinedStressMap((current) => {
      const existingPatterns = current[wordKey] ?? []
      const nextPatterns = existingPatterns.filter(
        (candidate) =>
          !(candidate.length === patternToDelete.length && candidate.every((value, index) => value === patternToDelete[index])),
      )

      if (nextPatterns.length === 0) {
        const nextMap = { ...current }
        delete nextMap[wordKey]
        return nextMap
      }

      return {
        ...current,
        [wordKey]: nextPatterns,
      }
    })
  }

  const deleteAllUserDefinedStressPatterns = () => {
    if (customStressEntries.length === 0) {
      return
    }

    const confirmed = window.confirm('Delete all custom stress patterns?')

    if (!confirmed) {
      return
    }

    setUserDefinedStressMap({})
  }

  const createOrUpdateStressPattern = (
    existingPattern: StressPatternDefinition | null,
  ): StressPatternDefinition | null => {
    const defaultName = existingPattern?.name ?? 'Untitled pattern'
    const defaultPattern = existingPattern?.pattern ?? 'x / | x / | x / | x / | x /'

    const nameInput = window.prompt('Name this stress pattern:', defaultName)

    if (nameInput === null) {
      return null
    }

    const normalizedName = normalizeStressPatternName(nameInput)

    if (normalizedName.length === 0) {
      window.alert('Please enter a name for the stress pattern.')
      return null
    }

    const patternInput = window.prompt(
      'Enter a pattern using / for stress, x for unstressed, | for foot breaks, and ? for either.\nExample: x / | x / | x / | x / | x /',
      defaultPattern,
    )

    if (patternInput === null) {
      return null
    }

    const parsed = parseStressPatternSyntax(patternInput)

    if (!parsed) {
      window.alert(
        'Please enter a valid pattern using only /, x, |, and ?.\nSeparate feet with | and keep it as a single continuous pattern.',
      )
      return null
    }

    return {
      id: existingPattern?.id ?? createStressPatternId(),
      name: normalizedName,
      pattern: parsed.normalized,
    }
  }

  const addStressPatternDefinition = () => {
    const nextPattern = createOrUpdateStressPattern(null)

    if (!nextPattern) {
      return
    }

    setStressPatternDefinitions((current) => {
      const hasDuplicateName = current.some(
        (item) => item.name.trim().toLowerCase() === nextPattern.name.trim().toLowerCase(),
      )

      if (hasDuplicateName) {
        window.alert('A stress pattern with that name already exists.')
        return current
      }

      return [...current, nextPattern]
    })
  }

  const editStressPatternDefinition = (patternId: string) => {
    const existingPattern = stressPatternDefinitions.find((pattern) => pattern.id === patternId) ?? null

    if (!existingPattern) {
      return
    }

    const nextPattern = createOrUpdateStressPattern(existingPattern)

    if (!nextPattern) {
      return
    }

    setStressPatternDefinitions((current) => {
      const hasDuplicateName = current.some(
        (item) =>
          item.id !== patternId &&
          item.name.trim().toLowerCase() === nextPattern.name.trim().toLowerCase(),
      )

      if (hasDuplicateName) {
        window.alert('A stress pattern with that name already exists.')
        return current
      }

      return current.map((item) => (item.id === patternId ? nextPattern : item))
    })
  }

  const deleteStressPatternDefinition = (patternId: string) => {
    const existingPattern = stressPatternDefinitions.find((pattern) => pattern.id === patternId) ?? null

    if (!existingPattern) {
      return
    }

    const confirmed = window.confirm(`Delete "${existingPattern.name}"?`)

    if (!confirmed) {
      return
    }

    setStressPatternDefinitions((current) => current.filter((pattern) => pattern.id !== patternId))
  }

  useEffect(() => {
    if (activeLineId === null || units?.status !== 'done' || visibleUnits.length === 0) {
      setSelectedUnitIndex(null)
      return
    }

    setSelectedUnitIndex((current) => {
      if (current === null) {
        return 0
      }

      if (current >= visibleUnits.length) {
        return 0
      }

      return current
    })
  }, [activeLineId, units?.status, visibleUnits.length])

  return (
    <main className="app-shell">
      <div className="app-frame">
        <div className="app-layout">
          <section className="editor-column" aria-label="Text sections">
            <section className="pattern-default-panel" aria-label="Default pattern target">
              <PatternAssignmentSelect
                label="Default"
                value={defaultPatternId}
                patternDefinitions={stressPatternDefinitions}
                onChange={setDefaultPatternId}
                className="pattern-assignment--wide"
              />
            </section>

            <div className="editor-list">
              {sections.map((section, index) => (
                <EditorCard
                  key={section.id}
                  section={section}
                  sectionNumber={index + 1}
                  patternDefinitions={stressPatternDefinitions}
                  assignedPatternId={resolvePatternAssignmentValue(
                    stressPatternAssignments.sectionPatternIds[String(section.id)] ?? null,
                    stressPatternDefinitions,
                  )}
                  lineMeterSeverityById={lineMeterSeverityById}
                  onChange={updateSection}
                  onDelete={deleteSection}
                  onCaretChange={handleCaretChange}
                  onPatternChange={setSectionPatternId}
                  registerRef={registerRef}
                  focusRequested={focusSectionId === section.id}
                />
              ))}
            </div>

            <div className="app-actions">
              <button className="add-section-button" type="button" onClick={addSection}>
                Add section
              </button>
            </div>
          </section>

          <aside className="side-column" aria-label="Pattern and info panels">
            <section className="info-panel" aria-label="Info panel">
              <div className="info-panel-content">
                {hasActiveCaret && activeSectionNumber !== null && activeLine !== null ? (
                  <>
                    <div className="info-panel-value-row">
                      <div className="info-panel-value">
                        Section {activeSectionNumber}, Line {activeLineNumber}
                      </div>

                      {isDebouncing ? (
                        <span
                          className="info-panel-spinner"
                          aria-label="Line is debouncing"
                          title="Line is debouncing"
                        />
                      ) : null}
                    </div>

                    <div className="info-panel-secondary">
                      {activeLine.text.trim().length > 0 ? activeLine.text : 'Empty line'}
                    </div>

                    <div className="info-panel-target-row">
                      <PatternAssignmentSelect
                        label="Line"
                        value={activeLinePatternId}
                        patternDefinitions={stressPatternDefinitions}
                        onChange={(patternId) =>
                          activeLineId !== null ? setLinePatternId(activeLineId, patternId) : undefined
                        }
                        className="pattern-assignment--inline"
                      />
                    </div>

                    <div className="info-panel-target-note">
                      Applied:{' '}
                      {activeEffectiveAssignment === FREE_STRESS_PATTERN_ASSIGNMENT
                        ? 'free'
                        : activeEffectivePattern?.name ?? 'none'}
                    </div>

                    <div className="info-panel-divider" aria-hidden="true" />

                    {visibleUnits.length > 0 ? (
                      <div className="info-stage-card">
                        <div className="token-sentence" aria-label="Units">
                          {visibleUnits.map((unit, index) => {
                            const previousUnit = visibleUnits[index - 1] ?? null
                            const shouldSpace = shouldInsertSpaceBeforeUnit(previousUnit, unit)
                            const assessment = visibleUnitMeterStressAssessments[index] ?? null
                            const stressIndicatorPattern = visibleUnitStressIndicatorPatterns[index] ?? null
                            const stressIndicatorDots = getStressIndicatorDots(stressIndicatorPattern)
                            const severityClass =
                              unit.kind === 'word' && assessment?.severity !== 'neutral'
                                ? ` token-word--${assessment.severity}`
                                : ''

                            return (
                              <span key={`${unit.id}-${index}`}>
                                {shouldSpace ? ' ' : null}
                                {unit.kind === 'word' ? (
                                  <span className="token-word-stack">
                                    <button
                                      type="button"
                                      className={
                                        selectedUnitIndex === index
                                          ? `token-word token-word--active${severityClass}`
                                          : `token-word${severityClass}`
                                      }
                                      onClick={() => setSelectedUnitIndex(index)}
                                      aria-pressed={selectedUnitIndex === index}
                                    >
                                      {unit.text}
                                    </button>
                                    {stressIndicatorDots.length > 0 ? (
                                      <span className="token-word-dots" aria-hidden="true">
                                        {stressIndicatorDots.map((isStress, dotIndex) => (
                                          <span
                                            key={`${unit.id}-${index}-dot-${dotIndex}`}
                                            className={
                                              isStress
                                                ? 'token-word-dot token-word-dot--stress'
                                                : 'token-word-dot'
                                            }
                                          />
                                        ))}
                                      </span>
                                    ) : null}
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    className={
                                      selectedUnitIndex === index
                                        ? `token-word token-word--active${severityClass}`
                                        : `token-word${severityClass}`
                                    }
                                    onClick={() => setSelectedUnitIndex(index)}
                                    aria-pressed={selectedUnitIndex === index}
                                  >
                                    {unit.text}
                                  </button>
                                )}
                              </span>
                            )
                          })}
                        </div>

                        <div className="info-panel-divider" aria-hidden="true" />

                        {selectedUnit ? (
                          <div className="token-detail">
                            <div className="token-detail-header">
                              <div className="token-detail-value">{selectedUnit.text}</div>
                              <div className="token-detail-kind">{selectedUnit.kind}</div>
                            </div>

                            <div className="token-detail-fact">
                              <span className="token-detail-meta-label">Part of speech</span>
                              <span className="token-detail-meta-value">
                                {selectedUnit.canonicalPos ?? 'n/a'}
                              </span>
                            </div>

                            {selectedUnit.kind === 'word' ? (
                              <div className="token-detail-stress-summary">
                                <div className="token-detail-stress-entry">
                                  <span className="token-detail-meta-label">Meter stress</span>
                                  <span
                                    className={`token-detail-meta-value token-detail-json token-detail-meter-stress token-detail-meter-stress--${
                                      selectedUnitMeterStress.severity
                                    }`}
                                  >
                                    {selectedUnitMeterStress.value ?? 'n/a'}
                                  </span>
                                  {selectedUnitMeterStress.reason ? (
                                    <span className="token-detail-note">
                                      {selectedUnitMeterStress.reason}
                                    </span>
                                  ) : null}
                                </div>

                                <div className="token-detail-stress-entry">
                                  <span className="token-detail-meta-label">Typical stresses</span>
                                  <span className="token-detail-meta-value token-detail-json">
                                    {typicalStressPatterns
                                      ? typicalStressPatterns.length > 0
                                        ? typicalStressPatterns.join('\n')
                                        : 'Was unable to find any pronunciation'
                                      : 'Was unable to find any pronunciation'}
                                  </span>
                                </div>

                                {otherStressPatterns && otherStressPatterns.length > 0 ? (
                                  <div className="token-detail-stress-entry">
                                    <span className="token-detail-meta-label">Other stresses</span>
                                    <span className="token-detail-meta-value token-detail-json">
                                      {otherStressPatterns.join('\n')}
                                    </span>
                                  </div>
                                ) : null}

                                <button
                                  type="button"
                                  className="token-detail-action"
                                  onClick={addUserDefinedStress}
                                >
                                  Add stress
                            </button>
                          </div>
                        ) : null}

                            <details className="token-detail-debug">
                              <summary className="token-detail-debug-summary">
                                <span>Debug</span>
                                <span className="token-detail-debug-icon" aria-hidden="true">
                                  ▸
                                </span>
                              </summary>
                              <div className="token-detail-meta">
                                <div>
                                  <span className="token-detail-meta-label">JSON stresses</span>
                                  <span className="token-detail-meta-value">
                                    {selectedUnit.pronunciations.jsonPronunciation.value
                                      ? `[${selectedUnit.pronunciations.jsonPronunciation.value.join(', ')}]`
                                      : 'n/a'}
                                  </span>
                                  {selectedUnit.pronunciations.jsonPronunciation.reason ? (
                                    <>
                                      <span className="token-detail-meta-label">JSON reason</span>
                                      <span className="token-detail-note">
                                        {selectedUnit.pronunciations.jsonPronunciation.reason}
                                      </span>
                                    </>
                                  ) : null}
                                </div>
                                <div>
                                  <span className="token-detail-meta-label">Dictionary stresses</span>
                                  <span className="token-detail-meta-value token-detail-json">
                                    {selectedUnit.pronunciations.dictionaryPronunciation.value
                                      ? selectedUnit.pronunciations.dictionaryPronunciation.value
                                          .map((pattern) => `[${pattern.join(', ')}]`)
                                          .join('\n')
                                      : 'n/a'}
                                  </span>
                                  {selectedUnit.pronunciations.dictionaryPronunciation.reason ? (
                                    <>
                                      <span className="token-detail-meta-label">Dictionary reason</span>
                                      <span className="token-detail-note">
                                        {selectedUnit.pronunciations.dictionaryPronunciation.reason}
                                      </span>
                                    </>
                                  ) : null}
                                </div>
                                <div>
                                  <span className="token-detail-meta-label">User stresses</span>
                                  <button type="button" className="token-detail-action" onClick={addUserDefinedStress}>
                                    Add stress
                                  </button>
                                  {selectedUserDefinedStressPatterns.length > 0 ? (
                                    <div className="token-detail-user-stresses">
                                      {selectedUserDefinedStressPatterns.map((pattern) => (
                                        <div key={pattern.join(',')} className="token-detail-user-stress">
                                          <span className="token-detail-meta-value token-detail-json">
                                            [{pattern.join(', ')}]
                                          </span>
                                          <button
                                            type="button"
                                            className="token-detail-delete"
                                            onClick={() =>
                                              selectedUnitWordKey !== null
                                                ? deleteUserDefinedStress(selectedUnitWordKey, pattern)
                                                : undefined
                                            }
                                            aria-label={`Delete user stress [${pattern.join(', ')}]`}
                                          >
                                            Delete
                                          </button>
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <span className="token-detail-note">
                                      No user-defined stresses yet.
                                    </span>
                                  )}
                                </div>
                                <div>
                                  <span className="token-detail-meta-label">Combined raw stresses</span>
                                  <span className="token-detail-meta-value token-detail-json">
                                    {combinedPossibleStresses.value
                                      ? combinedPossibleStresses.value
                                          .map((pattern) => `[${pattern.join(', ')}]`)
                                          .join('\n')
                                      : 'n/a'}
                                  </span>
                                  {combinedPossibleStresses.reason ? (
                                    <>
                                      <span className="token-detail-meta-label">Combined reason</span>
                                      <span className="token-detail-note">
                                        {combinedPossibleStresses.reason}
                                      </span>
                                    </>
                                  ) : null}
                                </div>
                                <div>
                                  <span className="token-detail-meta-label">Usual stress</span>
                                  <span className="token-detail-meta-value token-detail-json">
                                    {meterStressPatterns.value
                                      ? meterStressPatterns.value.usual.length > 0
                                        ? meterStressPatterns.value.usual.join('\n')
                                        : '[]'
                                      : 'n/a'}
                                  </span>
                                  {meterStressPatterns.reason ? (
                                    <>
                                      <span className="token-detail-meta-label">Usual reason</span>
                                      <span className="token-detail-note">
                                        {meterStressPatterns.reason}
                                      </span>
                                    </>
                                  ) : null}
                                </div>
                                <div>
                                  <span className="token-detail-meta-label">Unusual stress</span>
                                  <span className="token-detail-meta-value token-detail-json">
                                    {meterStressPatterns.value
                                      ? meterStressPatterns.value.unusual.length > 0
                                        ? meterStressPatterns.value.unusual.join('\n')
                                        : '[]'
                                      : 'n/a'}
                                  </span>
                                </div>
                                <div>
                                  <span className="token-detail-meta-label">Lookup text</span>
                                  <span className="token-detail-meta-value">
                                    {selectedUnit.lookupText ?? 'n/a'}
                                  </span>
                                </div>
                                <div>
                                  <span className="token-detail-meta-label">Unit index</span>
                                  <span className="token-detail-meta-value">
                                    {selectedUnitIndex !== null ? selectedUnitIndex + 1 : 1}
                                  </span>
                                </div>
                                <div>
                                  <span className="token-detail-meta-label">Dictionary</span>
                                  <span className="token-detail-meta-value">
                                    {selectedUnit.dictionary.status === 'running'
                                      ? 'Looking up'
                                      : selectedUnit.dictionary.status === 'queued'
                                        ? 'Queued'
                                        : selectedUnit.dictionary.entry
                                          ? 'Ready'
                                          : 'No entry found'}
                                  </span>
                                </div>
                                <div>
                                  <span className="token-detail-meta-label">Parts</span>
                                  <span className="token-detail-meta-value">
                                    {selectedUnit.tokens.map((token) => token.value).join(' + ')}
                                  </span>
                                </div>
                                <div className="token-detail-note">
                                  {selectedUnit.dictionary.status === 'running'
                                    ? 'Loading definition...'
                                    : selectedUnit.dictionary.status === 'queued'
                                      ? 'Waiting for dictionary lookup...'
                                      : getDictionaryPreview(selectedUnit.dictionary.entry)}
                                </div>
                              </div>
                            </details>
                          </div>
                        ) : (
                          <div className="token-detail token-detail--empty">
                            Click a unit to inspect it.
                          </div>
                        )}
                      </div>
                    ) : null}

                    {activeLine.analysis.error ? (
                      <>
                        <div className="info-panel-divider" aria-hidden="true" />
                        <div className="info-stage-error">{activeLine.analysis.error}</div>
                      </>
                    ) : null}
                  </>
                ) : (
                  <div className="info-panel-empty">No active caret</div>
                )}
              </div>
            </section>

            <section className="stress-library-panel" aria-label="Defined stress patterns">
              <div className="stress-library-header">
                <div className="stress-library-title">Stress patterns</div>

                <button type="button" className="stress-library-add-button" onClick={addStressPatternDefinition}>
                  Add
                </button>
              </div>

              {stressPatternDefinitions.length > 0 ? (
                <div className="stress-pattern-list">
                  {stressPatternDefinitions.map((pattern) => (
                    <article key={pattern.id} className="stress-pattern-card">
                      <div className="stress-pattern-card-header">
                        <div className="stress-pattern-name">{pattern.name}</div>

                        <div className="stress-pattern-actions">
                          <button
                            type="button"
                            className="stress-pattern-action"
                            onClick={() => editStressPatternDefinition(pattern.id)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="stress-pattern-action stress-pattern-action--danger"
                            onClick={() => deleteStressPatternDefinition(pattern.id)}
                          >
                            Delete
                          </button>
                        </div>
                      </div>

                      <div className="stress-pattern-pattern">{pattern.pattern}</div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="stress-library-empty">No patterns yet.</div>
              )}
            </section>

            <section className="custom-stresses-panel" aria-label="Custom stresses">
              <div className="custom-stresses-header">
                <div className="custom-stresses-title">Custom stresses</div>

                <button
                  type="button"
                  className="custom-stresses-clear-button"
                  onClick={deleteAllUserDefinedStressPatterns}
                  disabled={customStressEntries.length === 0}
                >
                  Clear all
                </button>
              </div>

              <div className="custom-stresses-summary">
                {customStressCount > 0
                  ? `${customStressCount} ${customStressCount === 1 ? 'custom stress' : 'custom stresses'} saved`
                  : 'No custom stresses saved.'}
              </div>
            </section>
          </aside>
        </div>
      </div>
    </main>
  )
}

export default App
