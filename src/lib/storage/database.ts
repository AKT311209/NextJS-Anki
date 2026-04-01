import initSqlJs, {
	type BindParams,
	type Database as SqlJsDatabase,
	type QueryExecResult,
	type SqlJsStatic,
	type SqlValue,
} from "sql.js";
import { applyMigrations } from "@/lib/storage/schema";
import { registerSqlFunctions } from "@/lib/storage/sql-functions";

export type QueryRow = Record<string, SqlValue>;

export interface CollectionDatabaseConnection {
	readonly id: string;
	select<T = QueryRow>(sql: string, params?: BindParams): Promise<T[]>;
	get<T = QueryRow>(sql: string, params?: BindParams): Promise<T | null>;
	run(sql: string, params?: BindParams): Promise<void>;
	exec(sql: string, params?: BindParams): Promise<QueryExecResult[]>;
	changes(): Promise<number>;
	transaction<T>(fn: (connection: CollectionDatabaseConnection) => Promise<T>): Promise<T>;
}

type PersistenceMode = "indexeddb" | "memory";

export interface CollectionDatabaseManagerOptions {
	readonly persistenceKey?: string;
	readonly autoSaveDebounceMs?: number;
	readonly persistenceMode?: PersistenceMode;
	readonly preferOpfs?: boolean;
	readonly initialBytes?: Uint8Array;
}

class CollectionDatabaseConnectionImpl implements CollectionDatabaseConnection {
	public constructor(
		private readonly manager: CollectionDatabaseManager,
		public readonly id: string,
	) {}

	public select<T = QueryRow>(sql: string, params?: BindParams): Promise<T[]> {
		return this.manager.select<T>(sql, params);
	}

	public get<T = QueryRow>(sql: string, params?: BindParams): Promise<T | null> {
		return this.manager.get<T>(sql, params);
	}

	public run(sql: string, params?: BindParams): Promise<void> {
		return this.manager.run(sql, params);
	}

	public exec(sql: string, params?: BindParams): Promise<QueryExecResult[]> {
		return this.manager.exec(sql, params);
	}

	public changes(): Promise<number> {
		return this.manager.changes();
	}

	public transaction<T>(fn: (connection: CollectionDatabaseConnection) => Promise<T>): Promise<T> {
		return this.manager.transaction(fn, this);
	}
}

export class CollectionDatabaseManager {
	private static readonly DEFAULT_PERSISTENCE_KEY = "nextjs-anki::collection";
	private static readonly DEFAULT_AUTOSAVE_DEBOUNCE_MS = 500;

	private readonly options: Required<
		Pick<
			CollectionDatabaseManagerOptions,
			"autoSaveDebounceMs" | "persistenceKey" | "persistenceMode" | "preferOpfs"
		>
	> &
		Pick<CollectionDatabaseManagerOptions, "initialBytes">;

	private sqlJs: SqlJsStatic | null = null;
	private database: SqlJsDatabase | null = null;
	private initialized = false;
	private opfsProbeSucceeded = false;
	private connections = new Map<string, CollectionDatabaseConnectionImpl>();
	private transactionDepth = 0;
	private pendingSaveAfterTransaction = false;
	private autoSaveTimer: ReturnType<typeof setTimeout> | null = null;

	public constructor(options: CollectionDatabaseManagerOptions = {}) {
		this.options = {
			autoSaveDebounceMs:
				options.autoSaveDebounceMs ?? CollectionDatabaseManager.DEFAULT_AUTOSAVE_DEBOUNCE_MS,
			persistenceKey:
				options.persistenceKey ?? CollectionDatabaseManager.DEFAULT_PERSISTENCE_KEY,
			persistenceMode: options.persistenceMode ?? "indexeddb",
			preferOpfs: options.preferOpfs ?? true,
			initialBytes: options.initialBytes,
		};
	}

	public get backend(): "sql.js" {
		return "sql.js";
	}

	public get opfsAvailable(): boolean {
		return this.opfsProbeSucceeded;
	}

	public async initialize(): Promise<void> {
		if (this.initialized) {
			return;
		}

		if (this.options.preferOpfs) {
			this.opfsProbeSucceeded = await this.probeWaSqliteOpfsSupport();
		}

		this.sqlJs = await initSqlJs();
		const persistedBytes = this.options.initialBytes ?? (await this.readPersistedBytes());
		this.database = new this.sqlJs.Database(persistedBytes ?? undefined);

		registerSqlFunctions(this.database);
		applyMigrations(this.database);

		this.initialized = true;
	}

	public async getConnection(connectionId = "main"): Promise<CollectionDatabaseConnection> {
		await this.ensureInitialized();

		const existing = this.connections.get(connectionId);
		if (existing) {
			return existing;
		}

		const connection = new CollectionDatabaseConnectionImpl(this, connectionId);
		this.connections.set(connectionId, connection);
		return connection;
	}

	public async select<T = QueryRow>(
		sql: string,
		params?: BindParams,
	): Promise<T[]> {
		const db = await this.requireDatabase();
		const statement = db.prepare(sql, params);
		try {
			const rows: T[] = [];
			while (statement.step()) {
				rows.push(statement.getAsObject() as T);
			}
			return rows;
		} finally {
			statement.free();
		}
	}

	public async get<T = QueryRow>(
		sql: string,
		params?: BindParams,
	): Promise<T | null> {
		const rows = await this.select<T>(sql, params);
		return rows[0] ?? null;
	}

	public async run(sql: string, params?: BindParams): Promise<void> {
		const db = await this.requireDatabase();
		db.run(sql, params);
		this.onPotentialMutation(sql);
	}

	public async exec(sql: string, params?: BindParams): Promise<QueryExecResult[]> {
		const db = await this.requireDatabase();
		const result = db.exec(sql, params);
		this.onPotentialMutation(sql);
		return result;
	}

	public async changes(): Promise<number> {
		const db = await this.requireDatabase();
		return db.getRowsModified();
	}

	public async transaction<T>(
		fn: (connection: CollectionDatabaseConnection) => Promise<T>,
		connection: CollectionDatabaseConnection,
	): Promise<T> {
		const db = await this.requireDatabase();
		const savepointName = `txn_${this.transactionDepth + 1}`;

		if (this.transactionDepth === 0) {
			db.run("BEGIN IMMEDIATE TRANSACTION");
		} else {
			db.run(`SAVEPOINT ${savepointName}`);
		}
		this.transactionDepth += 1;

		try {
			const result = await fn(connection);

			if (this.transactionDepth === 1) {
				db.run("COMMIT");
			} else {
				db.run(`RELEASE SAVEPOINT ${savepointName}`);
			}

			this.transactionDepth -= 1;
			if (this.transactionDepth === 0 && this.pendingSaveAfterTransaction) {
				this.pendingSaveAfterTransaction = false;
				this.scheduleAutoSave();
			}
			return result;
		} catch (error) {
			if (this.transactionDepth === 1) {
				db.run("ROLLBACK");
			} else {
				db.run(`ROLLBACK TO SAVEPOINT ${savepointName}`);
				db.run(`RELEASE SAVEPOINT ${savepointName}`);
			}
			this.transactionDepth -= 1;
			if (this.transactionDepth === 0) {
				this.pendingSaveAfterTransaction = false;
			}
			throw error;
		}
	}

	public async exportBytes(): Promise<Uint8Array> {
		const db = await this.requireDatabase();
		return db.export();
	}

	public async saveNow(): Promise<void> {
		if (this.options.persistenceMode === "memory") {
			return;
		}

		if (this.autoSaveTimer) {
			clearTimeout(this.autoSaveTimer);
			this.autoSaveTimer = null;
		}

		const bytes = await this.exportBytes();
		await this.writePersistedBytes(bytes);
	}

	public async close(): Promise<void> {
		if (!this.initialized || !this.database) {
			return;
		}

		await this.saveNow();

		if (this.autoSaveTimer) {
			clearTimeout(this.autoSaveTimer);
			this.autoSaveTimer = null;
		}

		this.database.close();
		this.database = null;
		this.initialized = false;
		this.connections.clear();
	}

	private async ensureInitialized(): Promise<void> {
		if (!this.initialized) {
			await this.initialize();
		}
	}

	private async requireDatabase(): Promise<SqlJsDatabase> {
		await this.ensureInitialized();
		if (!this.database) {
			throw new Error("Database is not initialized");
		}
		return this.database;
	}

	private onPotentialMutation(sql: string): void {
		if (!isMutatingSql(sql)) {
			return;
		}

		if (this.transactionDepth > 0) {
			this.pendingSaveAfterTransaction = true;
			return;
		}

		this.scheduleAutoSave();
	}

	private scheduleAutoSave(): void {
		if (this.options.persistenceMode === "memory") {
			return;
		}

		if (this.autoSaveTimer) {
			clearTimeout(this.autoSaveTimer);
		}

		this.autoSaveTimer = setTimeout(() => {
			void this.saveNow();
		}, this.options.autoSaveDebounceMs);
	}

	private async readPersistedBytes(): Promise<Uint8Array | null> {
		if (this.options.persistenceMode === "memory") {
			return null;
		}

		const fromIndexedDb = await readBytesFromIndexedDb(this.options.persistenceKey);
		if (fromIndexedDb) {
			return fromIndexedDb;
		}

		const fromLocalStorage = readBytesFromLocalStorage(this.options.persistenceKey);
		return fromLocalStorage;
	}

	private async writePersistedBytes(bytes: Uint8Array): Promise<void> {
		if (this.options.persistenceMode === "memory") {
			return;
		}

		const wroteToIndexedDb = await writeBytesToIndexedDb(this.options.persistenceKey, bytes);
		if (!wroteToIndexedDb) {
			writeBytesToLocalStorage(this.options.persistenceKey, bytes);
		}
	}

	private async probeWaSqliteOpfsSupport(): Promise<boolean> {
		if (typeof navigator === "undefined" || typeof window === "undefined") {
			return false;
		}

		if (!("storage" in navigator) || typeof navigator.storage.getDirectory !== "function") {
			return false;
		}

		try {
			const opfsExampleModulePath = "wa-sqlite/src/examples/OriginPrivateFileSystemVFS.js";
			await Promise.all([
				import("wa-sqlite"),
				import("wa-sqlite/dist/wa-sqlite-async.mjs"),
				import(opfsExampleModulePath),
			]);
			return true;
		} catch {
			return false;
		}
	}
}

function isMutatingSql(sql: string): boolean {
	const normalized = sql.trimStart().toUpperCase();
	return (
		normalized.startsWith("INSERT") ||
		normalized.startsWith("UPDATE") ||
		normalized.startsWith("DELETE") ||
		normalized.startsWith("REPLACE") ||
		normalized.startsWith("CREATE") ||
		normalized.startsWith("DROP") ||
		normalized.startsWith("ALTER") ||
		normalized.startsWith("VACUUM")
	);
}

const IDB_DB_NAME = "nextjs-anki";
const IDB_STORE_NAME = "sqlite-databases";

async function openPersistenceDatabase(): Promise<IDBDatabase | null> {
	if (typeof indexedDB === "undefined") {
		return null;
	}

	return new Promise<IDBDatabase | null>((resolve) => {
		try {
			const request = indexedDB.open(IDB_DB_NAME, 1);
			request.onupgradeneeded = () => {
				const database = request.result;
				if (!database.objectStoreNames.contains(IDB_STORE_NAME)) {
					database.createObjectStore(IDB_STORE_NAME);
				}
			};

			request.onsuccess = () => resolve(request.result);
			request.onerror = () => resolve(null);
		} catch {
			resolve(null);
		}
	});
}

async function readBytesFromIndexedDb(key: string): Promise<Uint8Array | null> {
	const db = await openPersistenceDatabase();
	if (!db) {
		return null;
	}

	return new Promise<Uint8Array | null>((resolve) => {
		try {
			const transaction = db.transaction(IDB_STORE_NAME, "readonly");
			const store = transaction.objectStore(IDB_STORE_NAME);
			const request = store.get(key);

			request.onsuccess = () => {
				const value = request.result;
				if (value instanceof Uint8Array) {
					resolve(value);
					return;
				}
				if (value instanceof ArrayBuffer) {
					resolve(new Uint8Array(value));
					return;
				}
				resolve(null);
			};

			request.onerror = () => resolve(null);
		} catch {
			resolve(null);
		}
	});
}

async function writeBytesToIndexedDb(key: string, bytes: Uint8Array): Promise<boolean> {
	const db = await openPersistenceDatabase();
	if (!db) {
		return false;
	}

	return new Promise<boolean>((resolve) => {
		try {
			const transaction = db.transaction(IDB_STORE_NAME, "readwrite");
			const store = transaction.objectStore(IDB_STORE_NAME);
			store.put(bytes, key);
			transaction.oncomplete = () => resolve(true);
			transaction.onerror = () => resolve(false);
		} catch {
			resolve(false);
		}
	});
}

function readBytesFromLocalStorage(key: string): Uint8Array | null {
	if (typeof localStorage === "undefined") {
		return null;
	}

	try {
		const encoded = localStorage.getItem(key);
		if (!encoded) {
			return null;
		}
		return decodeBase64(encoded);
	} catch {
		return null;
	}
}

function writeBytesToLocalStorage(key: string, bytes: Uint8Array): void {
	if (typeof localStorage === "undefined") {
		return;
	}

	try {
		localStorage.setItem(key, encodeBase64(bytes));
	} catch {
		// localStorage may be unavailable (private mode/disabled).
	}
}

function encodeBase64(bytes: Uint8Array): string {
	if (typeof Buffer !== "undefined") {
		return Buffer.from(bytes).toString("base64");
	}

	let binary = "";
	for (let index = 0; index < bytes.length; index += 1) {
		binary += String.fromCharCode(bytes[index]);
	}
	return btoa(binary);
}

function decodeBase64(encoded: string): Uint8Array {
	if (typeof Buffer !== "undefined") {
		return new Uint8Array(Buffer.from(encoded, "base64"));
	}

	const binary = atob(encoded);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}
	return bytes;
}
