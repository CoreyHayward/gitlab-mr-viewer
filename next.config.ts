import type { NextConfig } from "next";

// Determine if we're building for GitHub Pages
const isGithubPages = process.env.GITHUB_PAGES === 'true';

const nextConfig: NextConfig = {
  /* config options here */
  output: "export", // Enable static export for GitHub Pages
  trailingSlash: true, // Required for GitHub Pages
  basePath: isGithubPages ? '/gitlab-mr-viewer' : '',
  assetPrefix: isGithubPages ? '/gitlab-mr-viewer/' : '',
  images: {
    unoptimized: true, // Required for static export
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
      {
        protocol: 'http',
        hostname: '**',
      },
    ],
  },
};

export default nextConfig;
