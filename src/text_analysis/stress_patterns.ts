export type StressPatternSymbol = '/' | 'x' | '?'
export type StressPatternToken = StressPatternSymbol | '|'

export interface StressPatternDefinition {
  id: string
  name: string
  pattern: string
}

export interface StressPatternAssignments {
  defaultPatternId: string | null
  sectionPatternIds: Record<string, string>
  linePatternIds: Record<string, string>
}

export interface ParsedStressPattern {
  symbols: StressPatternToken[]
  normalized: string
  syllableCount: number
  footCount: number
  hasWildcard: boolean
}

const stressPatternStorageKey = 'my-react-exp:stress-pattern-library:v1'
const stressPatternAssignmentsStorageKey = 'my-react-exp:stress-pattern-assignments:v1'
export const FREE_STRESS_PATTERN_ASSIGNMENT = 'free'

export function createDefaultStressPatternDefinitions(): StressPatternDefinition[] {
  return [
    {
      id: 'iambic-pentameter',
      name: 'Iambic pentameter',
      pattern: 'x / | x / | x / | x / | x /',
    },
  ]
}

export function parseStressPatternInput(input: string): ParsedStressPattern | null {
  const compact = input.trim().replace(/\s+/g, '')

  if (compact.length === 0) {
    return null
  }

  const symbols: StressPatternToken[] = []

  for (const char of compact) {
    if (char === 'x' || char === 'X') {
      symbols.push('x')
      continue
    }

    if (char === '/' ) {
      symbols.push('/')
      continue
    }

    if (char === '?') {
      symbols.push('?')
      continue
    }

    if (char === '|') {
      if (symbols.length === 0 || symbols[symbols.length - 1] === '|') {
        return null
      }

      symbols.push('|')
      continue
    }

    return null
  }

  if (symbols[0] === '|' || symbols[symbols.length - 1] === '|') {
    return null
  }

  const syllableCount = symbols.filter((symbol) => symbol !== '|').length
  const footCount = symbols.filter((symbol) => symbol === '|').length + 1

  return {
    symbols,
    normalized: symbols.join(' '),
    syllableCount,
    footCount,
    hasWildcard: symbols.includes('?'),
  }
}

export function normalizeStressPatternName(name: string) {
  return name.trim().replace(/\s+/g, ' ')
}

export function loadStressPatternDefinitions(): StressPatternDefinition[] {
  if (typeof window === 'undefined') {
    return createDefaultStressPatternDefinitions()
  }

  const rawValue = window.localStorage.getItem(stressPatternStorageKey)

  if (!rawValue) {
    return createDefaultStressPatternDefinitions()
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown

    if (!Array.isArray(parsed)) {
      return createDefaultStressPatternDefinitions()
    }

    const definitions: StressPatternDefinition[] = []

    for (const item of parsed) {
      if (!item || typeof item !== 'object') {
        continue
      }

      const candidate = item as Partial<StressPatternDefinition>
      const name = typeof candidate.name === 'string' ? normalizeStressPatternName(candidate.name) : ''
      const pattern = typeof candidate.pattern === 'string' ? parseStressPatternInput(candidate.pattern) : null

      if (!name || !pattern) {
        continue
      }

      definitions.push({
        id: typeof candidate.id === 'string' && candidate.id.trim().length > 0 ? candidate.id : createStressPatternId(),
        name,
        pattern: pattern.normalized,
      })
    }

    return definitions.length > 0 ? definitions : createDefaultStressPatternDefinitions()
  } catch {
    return createDefaultStressPatternDefinitions()
  }
}

export function saveStressPatternDefinitions(definitions: StressPatternDefinition[]) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(stressPatternStorageKey, JSON.stringify(definitions))
}

export function createDefaultStressPatternAssignments(): StressPatternAssignments {
  return {
    defaultPatternId: 'iambic-pentameter',
    sectionPatternIds: {},
    linePatternIds: {},
  }
}

export function loadStressPatternAssignments(): StressPatternAssignments {
  if (typeof window === 'undefined') {
    return createDefaultStressPatternAssignments()
  }

  const rawValue = window.localStorage.getItem(stressPatternAssignmentsStorageKey)

  if (!rawValue) {
    return createDefaultStressPatternAssignments()
  }

  try {
    const parsed = JSON.parse(rawValue) as Record<string, unknown>

    if (!parsed || typeof parsed !== 'object') {
      return createDefaultStressPatternAssignments()
    }

    return {
      defaultPatternId: typeof parsed.defaultPatternId === 'string' ? parsed.defaultPatternId : null,
      sectionPatternIds: normalizeAssignmentMap(parsed.sectionPatternIds),
      linePatternIds: normalizeAssignmentMap(parsed.linePatternIds),
    }
  } catch {
    return createDefaultStressPatternAssignments()
  }
}

export function saveStressPatternAssignments(assignments: StressPatternAssignments) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(stressPatternAssignmentsStorageKey, JSON.stringify(assignments))
}

export function normalizeStressPatternAssignmentValue(
  value: string | null,
  validPatternIds: Set<string>,
) {
  if (value === null) {
    return null
  }

  if (value === FREE_STRESS_PATTERN_ASSIGNMENT) {
    return FREE_STRESS_PATTERN_ASSIGNMENT
  }

  return validPatternIds.has(value) ? value : null
}

export function createStressPatternId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `stress-pattern-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function normalizeAssignmentMap(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  const result: Record<string, string> = {}

  for (const [key, candidate] of Object.entries(value)) {
    if (typeof candidate !== 'string' || candidate.trim().length === 0) {
      continue
    }

    result[key] = candidate
  }

  return result
}
