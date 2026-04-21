/** @type {import('next').NextConfig} */
const distDir = process.env.NEXT_DIST_DIR || ".next";

const nextConfig = {
  distDir,
  outputFileTracingRoot: import.meta.dirname,
  devIndicators: false,
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@react-native-async-storage/async-storage": false,
      "pino-pretty": false,
    };

    return config;
  },
};

export default nextConfig;
