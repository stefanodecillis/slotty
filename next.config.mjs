/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  output: 'standalone',
  experimental: {
    instrumentationHook: true,
    // Prevent bundling of these Node.js-only npm packages.
    serverComponentsExternalPackages: [
      'googleapis',
      'google-auth-library',
      'gaxios',
      'gcp-metadata',
      'https-proxy-agent',
      'agent-base',
      'sharp',
      'argon2',
      'pino',
      'pino-pretty',
    ],
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
    ],
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      // serverComponentsExternalPackages only externalizes for Server Components.
      // Our instrumentation hook + in-process scheduler also need these as externals
      // so googleapis (which transitively imports node:http2/stream) isn't bundled.
      const extraExternals = [
        // googleapis subtree
        'googleapis',
        'googleapis-common',
        'google-auth-library',
        'gaxios',
        'gcp-metadata',
        'https-proxy-agent',
        'agent-base',
        // native modules
        'sharp',
        'argon2',
        // pino + transitive worker-thread deps. Bundling these breaks
        // pino-pretty's worker (it tries to resolve vendor-chunks/lib/worker.js).
        'pino',
        'pino-pretty',
        'pino-abstract-transport',
        'thread-stream',
        'sonic-boom',
        'on-exit-leak-free',
        'real-require',
        'quick-format-unescaped',
        'fast-redact',
        'safe-stable-stringify',
        'split2',
        'colorette',
        'fast-copy',
        'dateformat',
        'secure-json-parse',
        'pump',
      ];
      const existing = Array.isArray(config.externals) ? config.externals : [config.externals].filter(Boolean);
      config.externals = [
        ...existing,
        ({ request }, callback) => {
          if (!request) return callback();
          // Node.js built-ins via node: protocol — externalize as commonjs
          // so they're require()'d at runtime instead of bundled.
          if (request.startsWith('node:')) {
            return callback(null, `commonjs ${request}`);
          }
          if (extraExternals.some((p) => request === p || request.startsWith(`${p}/`))) {
            return callback(null, `commonjs ${request}`);
          }
          callback();
        },
      ];
    } else {
      // Client bundle: stub Node built-ins that may be referenced transitively.
      config.resolve = config.resolve ?? {};
      config.resolve.fallback = {
        ...(config.resolve.fallback ?? {}),
        fs: false,
        path: false,
        child_process: false,
        net: false,
        http: false,
        https: false,
        stream: false,
        zlib: false,
        crypto: false,
        http2: false,
        tls: false,
        os: false,
      };
    }
    return config;
  },
};

export default nextConfig;
