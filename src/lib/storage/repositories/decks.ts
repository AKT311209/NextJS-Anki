import type { CollectionDatabaseConnection } from "@/lib/storage/database";

export interface DeckRecord {
    readonly id: number;
    readonly name: string;
    readonly collapsed?: boolean;
    readonly browserCollapsed?: boolean;
    readonly conf?: number;
    readonly desc?: string;
    readonly dyn?: number;
    readonly extendNew?: number;
    readonly extendRev?: number;
    readonly lastDayStudied?: number;
    readonly newStudied?: number;
    readonly reviewStudied?: number;
    readonly learningStudied?: number;
    readonly millisecondsStudied?: number;
    readonly mod?: number;
    readonly usn?: number;
}

interface DecksContainerRow {
    readonly decks: string;
}

export class DecksRepository {
    public constructor(private readonly connection: CollectionDatabaseConnection) { }

    public async list(): Promise<DeckRecord[]> {
        const deckMap = await this.getDeckMap();
        return Object.values(deckMap).sort((a, b) => a.name.localeCompare(b.name));
    }

    public async getById(deckId: number): Promise<DeckRecord | null> {
        const deckMap = await this.getDeckMap();
        return deckMap[String(deckId)] ?? null;
    }

    public async create(name: string, partial: Partial<DeckRecord> = {}): Promise<DeckRecord> {
        const deckMap = await this.getDeckMap();
        const now = Date.now();
        const deckId = this.resolveNextDeckId(deckMap, partial.id, now);

        const deck: DeckRecord = {
            id: deckId,
            name,
            conf: partial.conf ?? 1,
            desc: partial.desc ?? "",
            dyn: partial.dyn ?? 0,
            extendNew: partial.extendNew ?? 0,
            extendRev: partial.extendRev ?? 0,
            lastDayStudied: partial.lastDayStudied ?? 0,
            newStudied: partial.newStudied ?? 0,
            reviewStudied: partial.reviewStudied ?? 0,
            learningStudied: partial.learningStudied ?? 0,
            millisecondsStudied: partial.millisecondsStudied ?? 0,
            collapsed: partial.collapsed ?? false,
            browserCollapsed: partial.browserCollapsed ?? false,
            mod: partial.mod ?? now,
            usn: partial.usn ?? 0,
        };

        deckMap[String(deckId)] = deck;
        await this.saveDeckMap(deckMap);

        return deck;
    }

    private resolveNextDeckId(
        deckMap: Record<string, DeckRecord>,
        preferredId: number | undefined,
        fallbackId: number,
    ): number {
        const seed =
            typeof preferredId === "number" && Number.isFinite(preferredId)
                ? Math.max(1, Math.trunc(preferredId))
                : Math.max(1, Math.trunc(fallbackId));

        let candidate = seed;
        while (deckMap[String(candidate)]) {
            candidate += 1;
        }

        return candidate;
    }

    public async update(deckId: number, patch: Partial<DeckRecord>): Promise<void> {
        const deckMap = await this.getDeckMap();
        const existing = deckMap[String(deckId)];
        if (!existing) {
            return;
        }

        deckMap[String(deckId)] = {
            ...existing,
            ...patch,
            id: deckId,
            mod: Date.now(),
        };
        await this.saveDeckMap(deckMap);
    }

    public async delete(deckId: number): Promise<void> {
        await this.connection.run(
            "DELETE FROM revlog WHERE cid IN (SELECT id FROM cards WHERE did = ?)",
            [deckId],
        );
        await this.connection.run("DELETE FROM cards WHERE did = ?", [deckId]);

        const deckMap = await this.getDeckMap();
        delete deckMap[String(deckId)];
        await this.saveDeckMap(deckMap);
    }

    public async getHierarchy(): Promise<Record<string, unknown>> {
        const decks = await this.list();
        const root: Record<string, unknown> = {};

        for (const deck of decks) {
            const parts = deck.name.split("::").filter((part) => part.length > 0);
            let current = root;
            for (let index = 0; index < parts.length; index += 1) {
                const part = parts[index];
                if (!(part in current)) {
                    current[part] = {};
                }
                if (index === parts.length - 1) {
                    (current[part] as Record<string, unknown>)._deck = deck;
                }
                current = current[part] as Record<string, unknown>;
            }
        }

        return root;
    }

    public async getDeckCounts(deckId: number): Promise<{
        readonly total: number;
        readonly newCount: number;
        readonly learningCount: number;
        readonly reviewCount: number;
    }> {
        const row = await this.connection.get<{
            readonly total: number;
            readonly newCount: number;
            readonly learningCount: number;
            readonly reviewCount: number;
        }>(
            `
			SELECT
				COUNT(*) AS total,
				SUM(CASE WHEN queue = 0 THEN 1 ELSE 0 END) AS newCount,
				SUM(CASE WHEN queue IN (1, 3) THEN 1 ELSE 0 END) AS learningCount,
				SUM(CASE WHEN queue = 2 THEN 1 ELSE 0 END) AS reviewCount
			FROM cards
			WHERE did = ?
			`,
            [deckId],
        );

        return {
            total: Number(row?.total ?? 0),
            newCount: Number(row?.newCount ?? 0),
            learningCount: Number(row?.learningCount ?? 0),
            reviewCount: Number(row?.reviewCount ?? 0),
        };
    }

    private async getDeckMap(): Promise<Record<string, DeckRecord>> {
        const row = await this.connection.get<DecksContainerRow>(
            "SELECT decks FROM col WHERE id = 1 LIMIT 1",
        );

        if (!row || row.decks.trim().length === 0) {
            return {};
        }

        try {
            const parsed = JSON.parse(row.decks) as unknown;
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                return parsed as Record<string, DeckRecord>;
            }
            return {};
        } catch {
            return {};
        }
    }

    private async saveDeckMap(deckMap: Record<string, DeckRecord>): Promise<void> {
        await this.connection.run("UPDATE col SET decks = ?, mod = ? WHERE id = 1", [
            JSON.stringify(deckMap),
            Date.now(),
        ]);
    }
}
