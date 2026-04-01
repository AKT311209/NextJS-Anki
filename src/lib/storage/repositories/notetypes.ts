import type { CollectionDatabaseConnection } from "@/lib/storage/database";

export interface NotetypeRecord {
	readonly id: number;
	readonly name: string;
	readonly type?: number;
	readonly css?: string;
	readonly flds?: unknown[];
	readonly tmpls?: unknown[];
	readonly sortf?: number;
	readonly did?: number;
	readonly mod?: number;
	readonly usn?: number;
}

interface ModelsContainerRow {
	readonly models: string;
}

export class NotetypesRepository {
	public constructor(private readonly connection: CollectionDatabaseConnection) {}

	public async list(): Promise<NotetypeRecord[]> {
		const modelMap = await this.getModelMap();
		return Object.values(modelMap).sort((a, b) => a.name.localeCompare(b.name));
	}

	public async getById(notetypeId: number): Promise<NotetypeRecord | null> {
		const modelMap = await this.getModelMap();
		return modelMap[String(notetypeId)] ?? null;
	}

	public async create(name: string, partial: Partial<NotetypeRecord> = {}): Promise<NotetypeRecord> {
		const modelMap = await this.getModelMap();
		const now = Date.now();
		const id = partial.id ?? now;

		const notetype: NotetypeRecord = {
			id,
			name,
			type: partial.type ?? 0,
			css: partial.css ?? "",
			flds: partial.flds ?? [],
			tmpls: partial.tmpls ?? [],
			sortf: partial.sortf ?? 0,
			did: partial.did,
			mod: partial.mod ?? now,
			usn: partial.usn ?? 0,
		};

		modelMap[String(id)] = notetype;
		await this.saveModelMap(modelMap);

		return notetype;
	}

	public async update(notetypeId: number, patch: Partial<NotetypeRecord>): Promise<void> {
		const modelMap = await this.getModelMap();
		const existing = modelMap[String(notetypeId)];
		if (!existing) {
			return;
		}

		modelMap[String(notetypeId)] = {
			...existing,
			...patch,
			id: notetypeId,
			mod: Date.now(),
		};

		await this.saveModelMap(modelMap);
	}

	public async delete(notetypeId: number): Promise<void> {
		const modelMap = await this.getModelMap();
		delete modelMap[String(notetypeId)];
		await this.saveModelMap(modelMap);
	}

	private async getModelMap(): Promise<Record<string, NotetypeRecord>> {
		const row = await this.connection.get<ModelsContainerRow>(
			"SELECT models FROM col WHERE id = 1 LIMIT 1",
		);

		if (!row || row.models.trim().length === 0) {
			return {};
		}

		try {
			const parsed = JSON.parse(row.models) as unknown;
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				return parsed as Record<string, NotetypeRecord>;
			}
			return {};
		} catch {
			return {};
		}
	}

	private async saveModelMap(modelMap: Record<string, NotetypeRecord>): Promise<void> {
		await this.connection.run("UPDATE col SET models = ?, mod = ? WHERE id = 1", [
			JSON.stringify(modelMap),
			Date.now(),
		]);
	}
}
