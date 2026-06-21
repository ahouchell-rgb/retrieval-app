/** @type {import('next').NextConfig} */

// Origins allowed to EMBED this app in an <iframe> — the ScienceKit lesson page
// AND the interactive-science.com revision booklets embed retrieval practice
// (/embed/practice). Space-separated origin list.
// Defaults to the confirmed ScienceKit + interactive-science origins; override
// with ALLOWED_FRAME_ANCESTORS for other hosts. The *.vercel.app wildcard covers
// preview deployments — tighten to specific origins if you want it stricter.
// localhost:8000 is the interactive-science static site served locally for the
// pilot (python -m http.server 8000).
const frameAncestors = `'self' ${process.env.ALLOWED_FRAME_ANCESTORS || "https://science-kit.vercel.app https://*.vercel.app https://interactive-science.com https://*.interactive-science.com http://localhost:3000 http://localhost:8000"}`.trim();

const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Controls who may frame this app. We deliberately do NOT set
          // X-Frame-Options, which would block embedding outright.
          { key: "Content-Security-Policy", value: `frame-ancestors ${frameAncestors};` },
        ],
      },
    ];
  },
};
module.exports = nextConfig;
