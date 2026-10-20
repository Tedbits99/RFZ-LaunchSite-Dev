/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: { cpus: 1, useTypeScriptCli: false },
  webpack: (config) => { config.parallelism = 1; return config; },
};

module.exports = nextConfig;
