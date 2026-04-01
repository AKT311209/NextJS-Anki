import type { CollectionDatabaseConnection } from "@/lib/storage/database";

export interface RevlogRecord {
	readonly id: number;
	readonly cid: number;
	readonly usn: number;
	readonly ease: number;
	readonly ivl: number;
	readonly lastIvl: number;
	readonly factor: number;
	readonly time: number;
	readonly type: number;
}

export interface CreateRevlogInput {
	readonly id: number;
	readonly cid: number;
	readonly usn?: number;
	readonly ease: number;
	readonly ivl: number;
	readonly lastIvl: number;
	readonly factor: number;
	readonly time: number;
	readonly type: number;
}

export class RevlogRepository {
	public constructor(private readonly connection: CollectionDatabaseConnection) {}

	public async insert(input: CreateRevlogInput): Promise<number> {
		await this.connection.run(
			`
			INSERT INTO revlog (
				id, cid, usn, ease, ivl, lastIvl, factor, time, type
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			`,
			[
				input.id,
				input.cid,
				input.usn ?? 0,
				input.ease,
				input.ivl,
				input.lastIvl,
				input.factor,
				input.time,
				input.type,
			],
		);

		return input.id;
	}

	public async listByCardId(cardId: number, limit = 100): Promise<RevlogRecord[]> {
		return this.connection.select<RevlogRecord>(
			`
			SELECT *
			FROM revlog
			WHERE cid = ?
			ORDER BY id DESC
			LIMIT ?
			`,
			[cardId, limit],
		);
	}

	public async listByDateRange(startTimestamp: number, endTimestamp: number): Promise<RevlogRecord[]> {
		return this.connection.select<RevlogRecord>(
			`
			SELECT *
			FROM revlog
			WHERE id BETWEEN ? AND ?
			ORDER BY id ASC
			`,
			[startTimestamp, endTimestamp],
		);
	}

	public async deleteByCardId(cardId: number): Promise<void> {
		await this.connection.run("DELETE FROM revlog WHERE cid = ?", [cardId]);
	}
}
