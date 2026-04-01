import type { CollectionDatabaseConnection } from "@/lib/storage/database";

export type ConfigObject = Record<string, unknown>;

interface ConfigRow {
	readonly conf: string;
	readonly dconf: string;
}

export class ConfigRepository {
	public constructor(private readonly connection: CollectionDatabaseConnection) {}

	public async getGlobalConfig(): Promise<ConfigObject> {
		const row = await this.connection.get<Pick<ConfigRow, "conf">>(
			"SELECT conf FROM col WHERE id = 1 LIMIT 1",
		);
		return parseJsonConfig(row?.conf);
	}

	public async updateGlobalConfig(patch: ConfigObject): Promise<ConfigObject> {
		const current = await this.getGlobalConfig();
		const updated = { ...current, ...patch };

		await this.connection.run("UPDATE col SET conf = ?, mod = ? WHERE id = 1", [
			JSON.stringify(updated),
			Date.now(),
		]);

		return updated;
	}

	public async getDeckConfigs(): Promise<ConfigObject> {
		const row = await this.connection.get<Pick<ConfigRow, "dconf">>(
			"SELECT dconf FROM col WHERE id = 1 LIMIT 1",
		);
		return parseJsonConfig(row?.dconf);
	}

	public async getDeckConfig(deckConfigId: number): Promise<ConfigObject | null> {
		const deckConfigs = await this.getDeckConfigs();
		const entry = deckConfigs[String(deckConfigId)];
		if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
			return null;
		}
		return entry as ConfigObject;
	}

	public async updateDeckConfig(deckConfigId: number, patch: ConfigObject): Promise<ConfigObject> {
		const deckConfigs = await this.getDeckConfigs();
		const existing = deckConfigs[String(deckConfigId)];

		const merged = {
			...(existing && typeof existing === "object" && !Array.isArray(existing)
				? (existing as ConfigObject)
				: {}),
			...patch,
		};

		const updatedDeckConfigs = {
			...deckConfigs,
			[String(deckConfigId)]: merged,
		};

		await this.connection.run("UPDATE col SET dconf = ?, mod = ? WHERE id = 1", [
			JSON.stringify(updatedDeckConfigs),
			Date.now(),
		]);

		return merged;
	}
}

function parseJsonConfig(value: string | undefined): ConfigObject {
	if (!value || value.trim().length === 0) {
		return {};
	}

	try {
		const parsed = JSON.parse(value) as unknown;
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as ConfigObject;
		}
		return {};
	} catch {
		return {};
	}
}
