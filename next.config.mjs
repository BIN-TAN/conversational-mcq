/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Intern repeated compiler strings and avoid retaining both string/buffer
  // copies. Keep lint, type checking and production optimization enabled.
  experimental: {
    webpackMemoryOptimizations: true,
    // A custom webpack callback otherwise disables Next's build worker default.
    webpackBuildWorker: true
  },
  webpack(config, { dev }) {
    // Avoid retaining the persistent compiler cache during production builds.
    // Preserve development caching and all existing cache files on disk.
    if (!dev) config.cache = false;
    return config;
  }
};

export default nextConfig;
