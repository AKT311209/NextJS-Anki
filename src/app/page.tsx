const links = [
    { href: "/review/demo", label: "Review" },
    { href: "/browse", label: "Browse" },
    { href: "/stats", label: "Stats" },
    { href: "/import", label: "Import" },
    { href: "/settings", label: "Settings" },
];

export default function HomePage() {
    return (
        <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-6 px-6 py-16">
            <h1 className="text-4xl font-bold tracking-tight">NextJS-Anki</h1>
            <p className="max-w-2xl text-slate-300">
                Phase 0 scaffold is ready: Next.js + TypeScript + Tailwind + PWA + testing + directory structure.
            </p>
            <ul className="grid gap-3 sm:grid-cols-2">
                {links.map((link) => (
                    <li key={link.href}>
                        <a
                            href={link.href}
                            className="block rounded-lg border border-slate-800 bg-slate-900 px-4 py-3 text-sm font-medium transition hover:border-slate-700 hover:bg-slate-800"
                        >
                            {link.label}
                        </a>
                    </li>
                ))}
            </ul>
        </main>
    );
}
