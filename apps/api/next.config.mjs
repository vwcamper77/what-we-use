/** @type {import("next").NextConfig} */
const nextConfig = {
  experimental: {
    externalDir: true
  },
  transpilePackages: ["@what-we-use/shared"]
};

export default nextConfig;
