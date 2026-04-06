import Link from "next/link";

export default function OfflineFallbackPage() {
    return (
        <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col items-start justify-center gap-5 px-4 py-10 sm:px-6">
            <p className="inline-flex rounded-full border border-amber-600/40 bg-amber-950/40 px-3 py-1 text-xs font-medium uppercase tracking-wide text-amber-200">
                Offline mode
            </p>
            <h1 className="text-3xl font-bold tracking-tight text-slate-100 sm:text-4xl">
                You&apos;re offline right now
            </h1>
            <p className="max-w-2xl text-sm text-slate-300 sm:text-base">
                No worries — your collection data is stored locally, so you can keep reviewing. Some pages may be
                unavailable until you reconnect.
            </p>
            <Link
                href="/"
                className="rounded-md border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-medium text-slate-100 transition hover:bg-slate-800"
            >
                Return to decks
            </Link>
        </main>
    );
}
