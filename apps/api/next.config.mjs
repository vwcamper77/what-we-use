/** @type {import("next").NextConfig} */
const nextConfig = {
  output: "standalone",
  experimental: {
    externalDir: true
  },
  transpilePackages: ["@what-we-use/shared"]
};

export default nextConfig;
