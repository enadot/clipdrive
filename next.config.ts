import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // yt-dlp and ffmpeg are spawned as child processes and Drive uploads stream
  // from disk, so the pipeline routes must run on the Node runtime.
  serverExternalPackages: ["googleapis", "@modelcontextprotocol/server"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "i.ytimg.com" },
      { protocol: "https", hostname: "img.youtube.com" },
    ],
  },
};

export default nextConfig;
