export type SearchNode =
    | SearchAllNode
    | SearchAndNode
    | SearchOrNode
    | SearchNotNode
    | SearchTermNode
    | SearchDeckNode
    | SearchNoteNode
    | SearchTagNode
    | SearchIsNode
    | SearchFlagNode
    | SearchCardIdNode
    | SearchNoteIdNode
    | SearchDeckIdNode
    | SearchNotetypeIdNode;

export interface SearchAllNode {
    readonly type: "all";
    readonly raw: string;
}

export interface SearchAndNode {
    readonly type: "and";
    readonly raw: string;
    readonly children: readonly SearchNode[];
}

export interface SearchOrNode {
    readonly type: "or";
    readonly raw: string;
    readonly children: readonly SearchNode[];
}

export interface SearchNotNode {
    readonly type: "not";
    readonly raw: string;
    readonly child: SearchNode;
}

export interface SearchTermNode {
    readonly type: "term";
    readonly raw: string;
    readonly value: string;
}

export interface SearchDeckNode {
    readonly type: "deck";
    readonly raw: string;
    readonly value: string;
}

export interface SearchNoteNode {
    readonly type: "note";
    readonly raw: string;
    readonly value: string;
}

export interface SearchTagNode {
    readonly type: "tag";
    readonly raw: string;
    readonly value: string;
}

export interface SearchIsNode {
    readonly type: "is";
    readonly raw: string;
    readonly value: string;
}

export interface SearchFlagNode {
    readonly type: "flag";
    readonly raw: string;
    readonly value: number;
}

export interface SearchCardIdNode {
    readonly type: "card-id";
    readonly raw: string;
    readonly value: number;
}

export interface SearchNoteIdNode {
    readonly type: "note-id";
    readonly raw: string;
    readonly value: number;
}

export interface SearchDeckIdNode {
    readonly type: "deck-id";
    readonly raw: string;
    readonly value: number;
}

export interface SearchNotetypeIdNode {
    readonly type: "notetype-id";
    readonly raw: string;
    readonly value: number;
}

export function createAllNode(raw = ""): SearchAllNode {
    return {
        type: "all",
        raw,
    };
}
