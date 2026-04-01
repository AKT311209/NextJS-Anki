export enum NotetypeKind {
    Standard = 0,
    Cloze = 1,
}

export interface NotetypeField {
    readonly name: string;
    readonly ord: number;
    readonly sticky?: boolean;
    readonly rtl?: boolean;
    readonly font?: string;
    readonly size?: number;
    readonly description?: string;
}

export interface NotetypeTemplate {
    readonly name: string;
    readonly ord: number;
    readonly qfmt: string;
    readonly afmt: string;
    readonly did?: number | null;
    readonly bafmt?: string;
    readonly bqfmt?: string;
}

export interface Notetype {
    readonly id: number;
    readonly name: string;
    readonly type: number;
    readonly css: string;
    readonly flds: readonly NotetypeField[];
    readonly tmpls: readonly NotetypeTemplate[];
    readonly sortf: number;
    readonly did?: number;
    readonly mod?: number;
    readonly usn?: number;
}
