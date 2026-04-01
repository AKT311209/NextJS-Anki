import type { CollectionDatabaseConnection } from "@/lib/storage/database";
import { fnv1a32 } from "@/lib/storage/sql-functions";

const FIELD_SEPARATOR = "\x1f";

export interface NoteRecord {
	readonly id: number;
	readonly guid: string;
	readonly mid: number;
	readonly mod: number;
	readonly usn: number;
	readonly tags: string;
	readonly flds: string;
	readonly sfld: number;
	readonly csum: number;
	readonly flags: number;
	readonly data: string;
}

export interface CreateNoteInput {
	readonly id: number;
	readonly guid: string;
	readonly mid: number;
	readonly tags?: string;
	readonly fields: readonly string[];
	readonly mod?: number;
	readonly usn?: number;
	readonly sfld?: number;
	readonly csum?: number;
	readonly flags?: number;
	readonly data?: string;
}

export class NotesRepository {
	public constructor(private readonly connection: CollectionDatabaseConnection) {}

	public async create(input: CreateNoteInput): Promise<number> {
		const now = Date.now();
		const fields = input.fields.join(FIELD_SEPARATOR);
		const sortField = input.fields[0] ?? "";
		const checksum = input.csum ?? calculateNoteChecksum(sortField);

		await this.connection.run(
			`
			INSERT INTO notes (
				id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			`,
			[
				input.id,
				input.guid,
				input.mid,
				input.mod ?? now,
				input.usn ?? 0,
				formatTags(input.tags ?? ""),
				fields,
				input.sfld ?? normalizeSortField(sortField),
				checksum,
				input.flags ?? 0,
				input.data ?? "",
			],
		);

		return input.id;
	}

	public async getById(noteId: number): Promise<NoteRecord | null> {
		return this.connection.get<NoteRecord>("SELECT * FROM notes WHERE id = ? LIMIT 1", [noteId]);
	}

	public async update(noteId: number, patch: Partial<Omit<NoteRecord, "id">>): Promise<void> {
		const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
		if (entries.length === 0) {
			return;
		}

		const assignments = entries.map(([key]) => `${key} = ?`).join(", ");
		const values = entries.map(([, value]) => value);
		await this.connection.run(`UPDATE notes SET ${assignments} WHERE id = ?`, [...values, noteId]);
	}

	public async delete(noteId: number): Promise<void> {
		await this.connection.run("DELETE FROM notes WHERE id = ?", [noteId]);
	}

	public async getField(noteId: number, fieldOrdinal: number): Promise<string> {
		const row = await this.connection.get<{ readonly value: string }>(
			"SELECT field_at_index(flds, ?) as value FROM notes WHERE id = ? LIMIT 1",
			[fieldOrdinal, noteId],
		);
		return row?.value ?? "";
	}

	public async findDuplicates(mid: number, firstFieldValue: string): Promise<NoteRecord[]> {
		const normalizedField = firstFieldValue.trim();
		const checksum = calculateNoteChecksum(normalizedField);

		return this.connection.select<NoteRecord>(
			`
			SELECT *
			FROM notes
			WHERE mid = ?
			  AND csum = ?
			  AND field_at_index(flds, 0) = ?
			ORDER BY id ASC
			`,
			[mid, checksum, normalizedField],
		);
	}

	public async listByTag(tag: string): Promise<NoteRecord[]> {
		const normalized = tag.trim();
		return this.connection.select<NoteRecord>(
			"SELECT * FROM notes WHERE tags LIKE ? ORDER BY id ASC",
			[`% ${normalized} %`],
		);
	}
}

function formatTags(tags: string): string {
	const normalized = tags
		.split(" ")
		.map((tag) => tag.trim())
		.filter((tag) => tag.length > 0)
		.join(" ");

	return normalized.length > 0 ? ` ${normalized} ` : "";
}

function normalizeSortField(value: string): number {
	const numeric = Number(value);
	if (Number.isFinite(numeric)) {
		return Math.trunc(numeric);
	}
	return 0;
}

function calculateNoteChecksum(fieldValue: string): number {
	return fnv1a32(fieldValue.trim());
}
