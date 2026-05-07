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
    ],
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
    ],
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // On the client bundle, stub out Node.js built-in modules that may be
      // referenced transitively (e.g. from server-only modules webpack traces).
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
