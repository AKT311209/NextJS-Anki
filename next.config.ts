import type { NextConfig } from "next";
// next-pwa ships without complete TS declarations for config-time imports.
// Using require() keeps next.config.ts type-safe enough for runtime without polluting app types.
const withPWAInit = require("next-pwa");
const defaultRuntimeCaching = require("next-pwa/cache.js");

const runtimeCaching = [
    {
        urlPattern: /\.(?:wasm)$/i,
        handler: "CacheFirst",
        options: {
            cacheName: "static-wasm-assets",
            expiration: {
                maxEntries: 16,
                maxAgeSeconds: 7 * 24 * 60 * 60,
            },
        },
    },
    ...defaultRuntimeCaching,
];

const withPWA =
    process.env.NODE_ENV === "development"
        ? (config: NextConfig) => config
        : withPWAInit({
            dest: "public",
            register: true,
            skipWaiting: true,
            buildExcludes: [/middleware-manifest\.json$/],
            runtimeCaching,
            cacheOnFrontEndNav: true,
            fallbacks: {
                document: "/_offline",
            },
        });

const nextConfig: NextConfig = {
    reactStrictMode: true,
    allowedDevOrigins: ["127.0.0.1", "localhost"],
    async headers() {
        return [
            {
                source: "/:path*",
                headers: [
                    {
                        key: "Cross-Origin-Opener-Policy",
                        value: "same-origin",
                    },
                    {
                        key: "Cross-Origin-Embedder-Policy",
                        value: "require-corp",
                    },
                    {
                        key: "Cross-Origin-Resource-Policy",
                        value: "same-origin",
                    },
                ],
            },
        ];
    },
};

export default withPWA(nextConfig);
