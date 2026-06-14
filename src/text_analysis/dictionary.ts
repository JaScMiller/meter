import { normaliseDictionaryPos, type CanonicalPos } from "./part_of_speech";

export interface DictionaryEntry {
    word: string;
    rawEntry: unknown; // The raw entry from the dictionary, can be any type depending on the dictionary structure
}

interface FreeDictionaryEntry {
    partOfSpeech?: string;
}

interface FreeDictionaryResponse {
    entries: FreeDictionaryEntry[];
}

const dictionaryEntryCache = new Map<string, Promise<DictionaryEntry | null>>();

let apiRequestAvailable = false;
setInterval(() => {
    apiRequestAvailable = true;
}, 1000);

export async function lookupDictionaryEntry(word: string, pos: CanonicalPos): Promise<DictionaryEntry | null> {
    const cacheKey = createCacheKey(word, pos);
    const cachedLookup = dictionaryEntryCache.get(cacheKey);
    if (cachedLookup) {
        return cachedLookup;
    }

    const lookupPromise = (async () => {
        await waitForApiSlot();
        try {
            const response = await fetch(`https://freedictionaryapi.com/api/v1/entries/en/${encodeURIComponent(word)}`);
            if (!response.ok) {
                console.error(`Error fetching dictionary entry for ${word}: ${response.statusText}`);
                return null;
            }

            const data = (await response.json()) as FreeDictionaryResponse;
            const entry = [...data.entries].sort((left, right) => {
                const leftScore = scorePosMatch(
                    word,
                    pos,
                    normaliseDictionaryPos(left.partOfSpeech ?? ''),
                );

                const rightScore = scorePosMatch(
                    word,
                    pos,
                    normaliseDictionaryPos(right.partOfSpeech ?? ''),
                );

                return rightScore - leftScore;
            })[0];

            if (!entry) {
                const poses = data.entries.map((entry) => entry.partOfSpeech ?? '').join(', ');
                console.warn(`No dictionary entry found for ${word}. Available parts of speech: ${poses}`);
                return null;
            }

            return {
                word,
                rawEntry: entry
            };
        } catch (error) {
            console.error(`Error fetching dictionary entry for ${word}: ${error}`);
            return null;
        }
    })();

    dictionaryEntryCache.set(cacheKey, lookupPromise);

    try {
        return await lookupPromise;
    } catch (error) {
        dictionaryEntryCache.delete(cacheKey);
        throw error;
    }
}

function createCacheKey(word: string, pos: CanonicalPos) {
    return `${word.trim().toLowerCase()}::${pos}`;
}

function scorePosMatch(
    word: string,
    nlpPos: CanonicalPos,
    dictionaryPos: CanonicalPos,
): number {
    // The ideal case: both sources agree.
    if (nlpPos === dictionaryPos) {
        return 100;
    }

    /**
     * Some taggers classify words according to their role in a phrase.
     * Dictionary entries may instead use a narrower lexical category.
     *
     * Example:
     *   "three days ago"
     *   tagger: ADV
     *   dictionary: postposition -> ADP
     */
    if (nlpPos === "ADV" && dictionaryPos === "ADP") {
        return 50;
    }

    /**
     * A targeted lexical override is safer than making every ADV and
     * every ADP interchangeable.
     */
    if (
        word.toLowerCase() === "ago" &&
        dictionaryPos === "ADP"
    ) {
        return 90;
    }

    return 0;
}

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForApiSlot() {
    while (!apiRequestAvailable) {
        await sleep(1000);
    }

    apiRequestAvailable = false; // Mark the API request as used
}
