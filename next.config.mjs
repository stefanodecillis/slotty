/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  output: 'standalone',
  experimental: {
    instrumentationHook: true,
    // Server Components must NOT bundle these — they use Node.js core
    // features (native addons, child_process, http2) that don't survive
    // webpack's Node.js polyfill layer.
    serverComponentsExternalPackages: [
      'googleapis',
      'google-auth-library',
      'gaxios',
      'gcp-metadata',
      'https-proxy-agent',
      'agent-base',
      'sharp',
      'argon2',
    ],
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
    ],
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      // serverComponentsExternalPackages only applies to Server Components.
      // Our instrumentation hook + in-process scheduler need the same
      // packages externalized too — otherwise googleapis pulls in node:http2
      // and webpack chokes.
      const extraExternals = [
        'googleapis',
        'googleapis-common',
        'google-auth-library',
        'gaxios',
        'gcp-metadata',
        'https-proxy-agent',
        'agent-base',
        'sharp',
        'argon2',
      ];
      // All Node.js built-in modules — externalize whether imported as
      // `fs`, `crypto`, etc. or as `node:fs`, `node:crypto`, etc.
      const NODE_BUILTINS = new Set([
        'assert', 'async_hooks', 'buffer', 'child_process', 'cluster',
        'console', 'constants', 'crypto', 'dgram', 'dns', 'domain',
        'events', 'fs', 'fs/promises', 'http', 'http2', 'https',
        'inspector', 'module', 'net', 'os', 'path', 'path/posix',
        'path/win32', 'perf_hooks', 'process', 'punycode', 'querystring',
        'readline', 'repl', 'stream', 'stream/promises', 'stream/web',
        'string_decoder', 'sys', 'timers', 'timers/promises', 'tls',
        'trace_events', 'tty', 'url', 'util', 'util/types', 'v8',
        'vm', 'wasi', 'worker_threads', 'zlib',
      ]);
      const existing = Array.isArray(config.externals)
        ? config.externals
        : [config.externals].filter(Boolean);
      config.externals = [
        ...existing,
        ({ request }, callback) => {
          if (!request) return callback();
          // Node.js built-ins (with or without node: prefix).
          if (request.startsWith('node:')) {
            return callback(null, `commonjs ${request}`);
          }
          if (NODE_BUILTINS.has(request)) {
            return callback(null, `commonjs ${request}`);
          }
          if (extraExternals.some((p) => request === p || request.startsWith(`${p}/`))) {
            return callback(null, `commonjs ${request}`);
          }
          callback();
        },
      ];
    } else {
      // Client bundle: stub Node built-ins that may be referenced transitively
      // by Node-only modules webpack happens to trace through.
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
