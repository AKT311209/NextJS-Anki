import type { CollectionDatabaseConnection } from "@/lib/storage/database";

export interface MediaReference {
	readonly noteId: number;
	readonly filename: string;
	readonly source: "image" | "audio";
}

export class MediaRepository {
	public constructor(private readonly connection: CollectionDatabaseConnection) {}

	public async listAllReferences(): Promise<MediaReference[]> {
		const rows = await this.connection.select<{ readonly id: number; readonly flds: string }>(
			"SELECT id, flds FROM notes",
		);

		const references: MediaReference[] = [];
		for (const row of rows) {
			references.push(...extractMediaReferences(row.id, row.flds));
		}
		return references;
	}

	public async listReferencesByNote(noteId: number): Promise<MediaReference[]> {
		const row = await this.connection.get<{ readonly id: number; readonly flds: string }>(
			"SELECT id, flds FROM notes WHERE id = ? LIMIT 1",
			[noteId],
		);

		if (!row) {
			return [];
		}

		return extractMediaReferences(row.id, row.flds);
	}

	public async isFilenameReferenced(filename: string): Promise<boolean> {
		const normalized = filename.trim();
		const references = await this.listAllReferences();
		return references.some((reference) => reference.filename === normalized);
	}
}

const imageRegex = /<img\s+[^>]*src=["']([^"']+)["'][^>]*>/gi;
const soundRegex = /\[sound:([^\]]+)\]/gi;

function extractMediaReferences(noteId: number, fields: string): MediaReference[] {
	const references: MediaReference[] = [];
	const normalizedFields = fields ?? "";

	for (const match of normalizedFields.matchAll(imageRegex)) {
		const filename = match[1]?.trim();
		if (filename) {
			references.push({
				noteId,
				filename,
				source: "image",
			});
		}
	}

	for (const match of normalizedFields.matchAll(soundRegex)) {
		const filename = match[1]?.trim();
		if (filename) {
			references.push({
				noteId,
				filename,
				source: "audio",
			});
		}
	}

	return references;
}
