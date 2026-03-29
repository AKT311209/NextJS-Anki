import type { NextConfig } from "next";
import withPWAInit from "next-pwa";

const withPWA = withPWAInit({
    dest: "public",
    register: true,
    skipWaiting: true,
    disable: process.env.NODE_ENV === "development",
    buildExcludes: [/middleware-manifest\.json$/],
});

const nextConfig: NextConfig = {
    reactStrictMode: true,
    allowedDevOrigins: ["127.0.0.1", "localhost"],
    webpack: (config, { isServer }) => {
        config.experiments = {
            ...config.experiments,
            asyncWebAssembly: true,
            topLevelAwait: true,
        };

        config.module.rules.push({
            test: /\.wasm$/,
            type: "webassembly/async",
        });

        config.output.webassemblyModuleFilename = isServer
            ? "../static/wasm/[modulehash].wasm"
            : "static/wasm/[modulehash].wasm";

        return config;
    },
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
