import type { CollectionDatabaseConnection } from "@/lib/storage/database";

export interface CardRecord {
	readonly id: number;
	readonly nid: number;
	readonly did: number;
	readonly ord: number;
	readonly mod: number;
	readonly usn: number;
	readonly type: number;
	readonly queue: number;
	readonly due: number;
	readonly ivl: number;
	readonly factor: number;
	readonly reps: number;
	readonly lapses: number;
	readonly left: number;
	readonly odue: number;
	readonly odid: number;
	readonly flags: number;
	readonly data: string;
}

export interface CreateCardInput {
	readonly id: number;
	readonly nid: number;
	readonly did: number;
	readonly ord: number;
	readonly mod?: number;
	readonly usn?: number;
	readonly type?: number;
	readonly queue?: number;
	readonly due?: number;
	readonly ivl?: number;
	readonly factor?: number;
	readonly reps?: number;
	readonly lapses?: number;
	readonly left?: number;
	readonly odue?: number;
	readonly odid?: number;
	readonly flags?: number;
	readonly data?: string;
}

export interface DueCardQuery {
	readonly deckId?: number;
	readonly maxDue: number;
	readonly limit: number;
}

export class CardsRepository {
	public constructor(private readonly connection: CollectionDatabaseConnection) {}

	public async create(input: CreateCardInput): Promise<number> {
		const now = Date.now();

		await this.connection.run(
			`
			INSERT INTO cards (
				id, nid, did, ord, mod, usn, type, queue, due, ivl,
				factor, reps, lapses, left, odue, odid, flags, data
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			`,
			[
				input.id,
				input.nid,
				input.did,
				input.ord,
				input.mod ?? now,
				input.usn ?? 0,
				input.type ?? 0,
				input.queue ?? 0,
				input.due ?? 0,
				input.ivl ?? 0,
				input.factor ?? 0,
				input.reps ?? 0,
				input.lapses ?? 0,
				input.left ?? 0,
				input.odue ?? 0,
				input.odid ?? 0,
				input.flags ?? 0,
				input.data ?? "",
			],
		);

		return input.id;
	}

	public async getById(cardId: number): Promise<CardRecord | null> {
		const row = await this.connection.get<CardRecord>(
			"SELECT * FROM cards WHERE id = ? LIMIT 1",
			[cardId],
		);
		return row;
	}

	public async update(cardId: number, patch: Partial<Omit<CardRecord, "id">>): Promise<void> {
		const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
		if (entries.length === 0) {
			return;
		}

		const assignments = entries.map(([key]) => `${key} = ?`).join(", ");
		const values = entries.map(([, value]) => value);

		await this.connection.run(`UPDATE cards SET ${assignments} WHERE id = ?`, [...values, cardId]);
	}

	public async delete(cardId: number): Promise<void> {
		await this.connection.run("DELETE FROM cards WHERE id = ?", [cardId]);
	}

	public async listByNoteId(noteId: number): Promise<CardRecord[]> {
		const rows = await this.connection.select<CardRecord>(
			"SELECT * FROM cards WHERE nid = ? ORDER BY ord ASC",
			[noteId],
		);
		return rows;
	}

	public async getDueCards(query: DueCardQuery): Promise<CardRecord[]> {
		if (query.deckId !== undefined) {
			return this.connection.select<CardRecord>(
				`
				SELECT * FROM cards
				WHERE did = ?
				  AND queue IN (1, 2, 3)
				  AND due <= ?
				ORDER BY queue ASC, due ASC, id ASC
				LIMIT ?
				`,
				[query.deckId, query.maxDue, query.limit],
			);
		}

		return this.connection.select<CardRecord>(
			`
			SELECT * FROM cards
			WHERE queue IN (1, 2, 3)
			  AND due <= ?
			ORDER BY queue ASC, due ASC, id ASC
			LIMIT ?
			`,
			[query.maxDue, query.limit],
		);
	}

	public async getQueueCountsByDeck(deckId: number): Promise<{
		readonly newCount: number;
		readonly learningCount: number;
		readonly reviewCount: number;
	}> {
		const row = await this.connection.get<{
			readonly newCount: number;
			readonly learningCount: number;
			readonly reviewCount: number;
		}>(
			`
			SELECT
				SUM(CASE WHEN queue = 0 THEN 1 ELSE 0 END) AS newCount,
				SUM(CASE WHEN queue IN (1, 3) THEN 1 ELSE 0 END) AS learningCount,
				SUM(CASE WHEN queue = 2 THEN 1 ELSE 0 END) AS reviewCount
			FROM cards
			WHERE did = ?
			`,
			[deckId],
		);

		return {
			newCount: Number(row?.newCount ?? 0),
			learningCount: Number(row?.learningCount ?? 0),
			reviewCount: Number(row?.reviewCount ?? 0),
		};
	}
}
