import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

/**
 * Sentry build-time configuration.
 *
 * Wrapping the Next.js config with `withSentryConfig` enables:
 *   - automatic instrumentation of API routes, middleware and the app dir
 *   - source map upload (when `SENTRY_AUTH_TOKEN` is set at build time)
 *
 * When no DSN/auth token is configured, Sentry is a no-op at runtime and
 * build (the wrapper still safely passes through the user config).
 */
export default withSentryConfig(nextConfig, {
  // Only relevant when source map upload is desired. Set SENTRY_AUTH_TOKEN
  // in the build environment to enable uploads. Empty by default — local dev
  // and current Vercel builds run without it.
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  // Silence noisy "no auth token" log lines during local `next build` runs.
  silent: true,

  // Disable source-map upload unless explicitly opted in via env vars.
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },

  // Auto-instrument server functions, middleware, and the app directory.
  autoInstrumentServerFunctions: true,
  autoInstrumentMiddleware: true,
  autoInstrumentAppDirectory: true,
});
