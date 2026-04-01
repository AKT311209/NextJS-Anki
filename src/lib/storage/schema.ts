import type { Database as SqlJsDatabase } from "sql.js";

export interface SchemaMigration {
    readonly version: number;
    readonly name: string;
    readonly sql: string;
}

export const SCHEMA_MIGRATION_TABLE = "_anki_schema_migrations";

const SCHEMA11_CORE_SQL = `
CREATE TABLE IF NOT EXISTS col (
  id integer PRIMARY KEY,
  crt integer NOT NULL,
  mod integer NOT NULL,
  scm integer NOT NULL,
  ver integer NOT NULL,
  dty integer NOT NULL,
  usn integer NOT NULL,
  ls integer NOT NULL,
  conf text NOT NULL,
  models text NOT NULL,
  decks text NOT NULL,
  dconf text NOT NULL,
  tags text NOT NULL
);

CREATE TABLE IF NOT EXISTS notes (
  id integer PRIMARY KEY,
  guid text NOT NULL,
  mid integer NOT NULL,
  mod integer NOT NULL,
  usn integer NOT NULL,
  tags text NOT NULL,
  flds text NOT NULL,
  sfld integer NOT NULL,
  csum integer NOT NULL,
  flags integer NOT NULL,
  data text NOT NULL
);

CREATE TABLE IF NOT EXISTS cards (
  id integer PRIMARY KEY,
  nid integer NOT NULL,
  did integer NOT NULL,
  ord integer NOT NULL,
  mod integer NOT NULL,
  usn integer NOT NULL,
  type integer NOT NULL,
  queue integer NOT NULL,
  due integer NOT NULL,
  ivl integer NOT NULL,
  factor integer NOT NULL,
  reps integer NOT NULL,
  lapses integer NOT NULL,
  left integer NOT NULL,
  odue integer NOT NULL,
  odid integer NOT NULL,
  flags integer NOT NULL,
  data text NOT NULL
);

CREATE TABLE IF NOT EXISTS revlog (
  id integer PRIMARY KEY,
  cid integer NOT NULL,
  usn integer NOT NULL,
  ease integer NOT NULL,
  ivl integer NOT NULL,
  lastIvl integer NOT NULL,
  factor integer NOT NULL,
  time integer NOT NULL,
  type integer NOT NULL
);

CREATE TABLE IF NOT EXISTS graves (
  usn integer NOT NULL,
  oid integer NOT NULL,
  type integer NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_notes_usn ON notes (usn);
CREATE INDEX IF NOT EXISTS ix_cards_usn ON cards (usn);
CREATE INDEX IF NOT EXISTS ix_revlog_usn ON revlog (usn);
CREATE INDEX IF NOT EXISTS ix_cards_nid ON cards (nid);
CREATE INDEX IF NOT EXISTS ix_cards_sched ON cards (did, queue, due);
CREATE INDEX IF NOT EXISTS ix_revlog_cid ON revlog (cid);
CREATE INDEX IF NOT EXISTS ix_notes_csum ON notes (csum);

INSERT OR IGNORE INTO col
VALUES (
	1,
	0,
	0,
	0,
	11,
	0,
	0,
	0,
	'{}',
	'{}',
	'{}',
	'{}',
	'{}'
  );
`;

export const PHASE1_MIGRATIONS: readonly SchemaMigration[] = [
    {
        version: 1,
        name: "schema11-core",
        sql: SCHEMA11_CORE_SQL,
    },
] as const;

export function applyMigrations(database: SqlJsDatabase): void {
    ensureMigrationTable(database);
    const appliedVersions = getAppliedVersions(database);

    for (const migration of PHASE1_MIGRATIONS) {
        if (appliedVersions.has(migration.version)) {
            continue;
        }

        database.run("BEGIN IMMEDIATE TRANSACTION");
        try {
            database.exec(migration.sql);
            database.run(
                `
				INSERT INTO ${SCHEMA_MIGRATION_TABLE} (version, name, applied_at)
				VALUES (?, ?, ?)
				`,
                [migration.version, migration.name, Date.now()],
            );
            database.run("COMMIT");
        } catch (error) {
            database.run("ROLLBACK");
            throw error;
        }
    }
}

export function getCurrentSchemaVersion(database: SqlJsDatabase): number {
    ensureMigrationTable(database);

    const result = database.exec(`SELECT MAX(version) as version FROM ${SCHEMA_MIGRATION_TABLE}`);
    if (result.length === 0 || result[0].values.length === 0) {
        return 0;
    }

    const value = result[0].values[0]?.[0];
    if (typeof value !== "number") {
        return 0;
    }

    return value;
}

function ensureMigrationTable(database: SqlJsDatabase): void {
    database.exec(`
		CREATE TABLE IF NOT EXISTS ${SCHEMA_MIGRATION_TABLE} (
			version integer PRIMARY KEY,
			name text NOT NULL,
			applied_at integer NOT NULL
		);
	`);
}

function getAppliedVersions(database: SqlJsDatabase): Set<number> {
    const versions = new Set<number>();
    const result = database.exec(`SELECT version FROM ${SCHEMA_MIGRATION_TABLE}`);

    if (result.length === 0) {
        return versions;
    }

    for (const row of result[0].values) {
        const value = row[0];
        if (typeof value === "number") {
            versions.add(value);
        }
    }

    return versions;
}
