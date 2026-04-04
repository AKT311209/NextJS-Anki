import type { CollectionDatabaseConnection } from "@/lib/storage/database";
import { ConfigRepository } from "@/lib/storage/repositories/config";
import { DecksRepository, type DeckRecord } from "@/lib/storage/repositories/decks";
import { NotetypesRepository, type NotetypeRecord } from "@/lib/storage/repositories/notetypes";

export const DEFAULT_DECK_ID = 1;
export const DEFAULT_DECK_NAME = "Default";
export const DEFAULT_DECK_CONFIG_ID = 1;

const BASIC_NOTETYPE_ID = 100_001;
const BASIC_REVERSED_NOTETYPE_ID = 100_002;
const CLOZE_NOTETYPE_ID = 100_003;

const DEFAULT_DECK_CONFIG: Record<string, unknown> = {
    id: DEFAULT_DECK_CONFIG_ID,
    name: "Default",
    newPerDay: 20,
    reviewsPerDay: 200,
    learningPerDay: 200,
    learningSteps: ["1m", "10m"],
    relearningSteps: ["10m"],
    requestRetention: 0.9,
    maximumInterval: 36500,
    minimumLapseInterval: 1,
    minimum_lapse_interval: 1,
    burySiblings: false,
    buryNew: false,
    buryReviews: false,
    buryInterdayLearning: false,
    leechAction: "tag-only",
    enableFuzz: true,
    newCardGatherPriority: 0,
    new_card_gather_priority: 0,
    newGatherPriority: 0,
    newCardSortOrder: 0,
    new_card_sort_order: 0,
    newSortOrder: 0,
    newMix: 0,
    interdayLearningMix: 0,
    reviewOrder: 0,
    review_order: 0,
    disableAutoplay: false,
    disable_autoplay: false,
    skipQuestionWhenReplayingAnswer: false,
    skip_question_when_replaying_answer: false,
    capAnswerTimeToSecs: 60,
    cap_answer_time_to_secs: 60,
    showTimer: false,
    show_timer: false,
    stopTimerOnAnswer: false,
    stop_timer_on_answer: false,
    secondsToShowQuestion: 0,
    seconds_to_show_question: 0,
    secondsToShowAnswer: 0,
    seconds_to_show_answer: 0,
    questionAction: 0,
    question_action: 0,
    answerAction: 0,
    answer_action: 0,
    waitForAudio: true,
    wait_for_audio: true,
    easyDaysPercentages: [1, 1, 1, 1, 1, 1, 1],
    easy_days_percentages: [1, 1, 1, 1, 1, 1, 1],
    autoplay: true,
    replayq: true,
    maxTaken: 60,
    max_taken: 60,
    timer: 0,
    new: {
        perDay: 20,
        delays: [1, 10],
        bury: false,
    },
    rev: {
        perDay: 200,
        maxIvl: 36500,
        bury: false,
    },
    lapse: {
        delays: [10],
        minInt: 1,
        leechAction: 1,
    },
};

const DEFAULT_CARD_CSS = `
.card {
  font-family: arial;
  font-size: 20px;
  text-align: center;
  color: #e2e8f0;
  background-color: #0f172a;
}

.cloze {
  font-weight: bold;
  color: #60a5fa;
}
`;

export interface CollectionBootstrapResult {
    readonly defaultDeckId: number;
    readonly defaultDeckConfigId: number;
    readonly defaultNotetypeId: number;
}

export async function ensureCollectionBootstrap(
    connection: CollectionDatabaseConnection,
): Promise<CollectionBootstrapResult> {
    const decks = new DecksRepository(connection);
    const notetypes = new NotetypesRepository(connection);
    const config = new ConfigRepository(connection);

    const deckList = await decks.list();
    const defaultDeck = await ensureDefaultDeck(decks, deckList);

    const notetypeList = await notetypes.list();
    const defaultNotetypeId = await ensureBuiltInNotetypes(notetypes, notetypeList);

    await ensureDefaultDeckConfig(config);

    await config.updateGlobalConfig({
        currentDeckId: defaultDeck.id,
        currentNotetypeId: defaultNotetypeId,
        scheduler: "fsrs",
        collapseTime: 1200,
        newSpread: 0,
        newCardsIgnoreReviewLimit: false,
        applyAllParentLimits: false,
    });

    return {
        defaultDeckId: defaultDeck.id,
        defaultDeckConfigId: DEFAULT_DECK_CONFIG_ID,
        defaultNotetypeId,
    };
}

async function ensureDefaultDeckConfig(repository: ConfigRepository): Promise<void> {
    const existing = await repository.getDeckConfig(DEFAULT_DECK_CONFIG_ID);
    if (existing) {
        return;
    }

    await repository.updateDeckConfig(DEFAULT_DECK_CONFIG_ID, DEFAULT_DECK_CONFIG);
}

async function ensureDefaultDeck(
    repository: DecksRepository,
    existingDecks: readonly DeckRecord[],
): Promise<DeckRecord> {
    const byName = existingDecks.find((deck) => deck.name === DEFAULT_DECK_NAME);
    if (byName) {
        if (byName.conf !== DEFAULT_DECK_CONFIG_ID) {
            await repository.update(byName.id, { conf: DEFAULT_DECK_CONFIG_ID });
        }
        return byName;
    }

    if (existingDecks.length > 0) {
        const firstDeck = existingDecks[0];
        if (firstDeck.conf !== DEFAULT_DECK_CONFIG_ID) {
            await repository.update(firstDeck.id, { conf: DEFAULT_DECK_CONFIG_ID });
        }
        return {
            ...firstDeck,
            conf: DEFAULT_DECK_CONFIG_ID,
        };
    }

    return repository.create(DEFAULT_DECK_NAME, {
        id: DEFAULT_DECK_ID,
        conf: DEFAULT_DECK_CONFIG_ID,
        desc: "Auto-created default deck",
    });
}

async function ensureBuiltInNotetypes(
    repository: NotetypesRepository,
    existingNotetypes: readonly NotetypeRecord[],
): Promise<number> {
    const byName = new Map(existingNotetypes.map((notetype) => [notetype.name, notetype]));

    if (!byName.has("Basic")) {
        await repository.create("Basic", {
            id: BASIC_NOTETYPE_ID,
            type: 0,
            css: DEFAULT_CARD_CSS,
            flds: [
                { name: "Front", ord: 0 },
                { name: "Back", ord: 1 },
            ],
            tmpls: [
                {
                    name: "Card 1",
                    ord: 0,
                    qfmt: "{{Front}}",
                    afmt: "{{FrontSide}}<hr id='answer'>{{Back}}",
                },
            ],
        });
    }

    if (!byName.has("Basic (and reversed card)")) {
        await repository.create("Basic (and reversed card)", {
            id: BASIC_REVERSED_NOTETYPE_ID,
            type: 0,
            css: DEFAULT_CARD_CSS,
            flds: [
                { name: "Front", ord: 0 },
                { name: "Back", ord: 1 },
            ],
            tmpls: [
                {
                    name: "Card 1",
                    ord: 0,
                    qfmt: "{{Front}}",
                    afmt: "{{FrontSide}}<hr id='answer'>{{Back}}",
                },
                {
                    name: "Card 2",
                    ord: 1,
                    qfmt: "{{Back}}",
                    afmt: "{{FrontSide}}<hr id='answer'>{{Front}}",
                },
            ],
        });
    }

    if (!byName.has("Cloze")) {
        await repository.create("Cloze", {
            id: CLOZE_NOTETYPE_ID,
            type: 1,
            css: DEFAULT_CARD_CSS,
            flds: [
                { name: "Text", ord: 0 },
                { name: "Back Extra", ord: 1 },
            ],
            tmpls: [
                {
                    name: "Cloze",
                    ord: 0,
                    qfmt: "{{cloze:Text}}",
                    afmt: "{{cloze:Text}}<br>{{Back Extra}}",
                },
            ],
        });
    }

    const refreshed = await repository.list();
    const basic = refreshed.find((notetype) => notetype.name === "Basic") ?? refreshed[0];
    return basic?.id ?? BASIC_NOTETYPE_ID;
}
