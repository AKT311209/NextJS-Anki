import type { NextConfig } from "next";
import withPWAInit from "next-pwa";

const withPWA =
    process.env.NODE_ENV === "development"
        ? (config: NextConfig) => config
        : withPWAInit({
            dest: "public",
            register: true,
            skipWaiting: true,
            buildExcludes: [/middleware-manifest\.json$/],
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
