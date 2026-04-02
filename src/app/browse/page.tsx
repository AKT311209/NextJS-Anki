import { CardBrowser } from "@/components/browser/CardBrowser";

interface BrowsePageProps {
    readonly searchParams?: Promise<{
        readonly q?: string | readonly string[];
    }>;
}

export default async function BrowsePage({ searchParams }: BrowsePageProps) {
    const resolved = await searchParams;
    const raw = resolved?.q;
    const initialQuery = Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? "");

    return <CardBrowser initialQuery={initialQuery} />;
}
