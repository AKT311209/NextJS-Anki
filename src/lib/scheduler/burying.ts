import type { CollectionDatabaseConnection } from "@/lib/storage/database";
import { CardQueue, CardType, type Card } from "@/lib/types/card";

export type BuryMode = "scheduler" | "user";

export interface SiblingBuryMode {
    readonly buryNew: boolean;
    readonly buryReviews: boolean;
    readonly buryInterdayLearning: boolean;
}

export interface BurySiblingOptions {
    readonly card: Card;
    readonly mode?: BuryMode;
    readonly restrictToDeckId?: number;
    readonly buryMode?: SiblingBuryMode;
}

export async function burySiblingCards(
    connection: CollectionDatabaseConnection,
    options: BurySiblingOptions,
): Promise<number[]> {
    const targetQueue = options.mode === "user" ? CardQueue.UserBuried : CardQueue.SchedBuried;
    const mode = options.buryMode ?? {
        buryNew: true,
        buryReviews: true,
        buryInterdayLearning: true,
    };

    const queuesToBury = [
        mode.buryNew ? CardQueue.New : null,
        mode.buryReviews ? CardQueue.Review : null,
        mode.buryInterdayLearning ? CardQueue.DayLearning : null,
    ].filter((queue): queue is number => queue !== null);

    if (queuesToBury.length === 0) {
        return [];
    }

    const queuePlaceholders = queuesToBury.map(() => "?").join(", ");
    const deckClause = options.restrictToDeckId !== undefined ? "AND did = ?" : "";
    const deckParams = options.restrictToDeckId !== undefined ? [options.restrictToDeckId] : [];

    const rows = await connection.select<{ id: number }>(
        `
		SELECT id
		FROM cards
		WHERE nid = ?
		  AND id != ?
		  AND queue IN (${queuePlaceholders})
		  ${deckClause}
		ORDER BY id ASC
		`,
        [
            options.card.nid,
            options.card.id,
            ...queuesToBury,
            ...deckParams,
        ],
    );

    if (rows.length === 0) {
        return [];
    }

    const siblingIds = rows.map((row) => row.id);
    const placeholders = siblingIds.map(() => "?").join(", ");
    await connection.run(
        `UPDATE cards SET queue = ?, mod = ? WHERE id IN (${placeholders})`,
        [targetQueue, Date.now(), ...siblingIds],
    );

    return siblingIds;
}

export async function unburyCards(
    connection: CollectionDatabaseConnection,
    deckId?: number,
): Promise<number> {
    const sql = `
		UPDATE cards
		SET queue = CASE
			WHEN type = ${CardType.New} THEN ${CardQueue.New}
			WHEN type = ${CardType.Learning} THEN ${CardQueue.Learning}
			WHEN type = ${CardType.Review} THEN ${CardQueue.Review}
			WHEN type = ${CardType.Relearning} THEN ${CardQueue.Learning}
			ELSE queue
		END,
		mod = ?
		WHERE queue IN (${CardQueue.UserBuried}, ${CardQueue.SchedBuried})
		${deckId !== undefined ? "AND did = ?" : ""}
	`;

    if (deckId !== undefined) {
        await connection.run(sql, [Date.now(), deckId]);
    } else {
        await connection.run(sql, [Date.now()]);
    }

    return connection.changes();
}
