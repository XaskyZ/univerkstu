import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  experimental: {
    // Tree-shake icon/utility libs so importing one Lucide icon does not
    // pull the entire package into a client bundle.
    optimizePackageImports: ['lucide-react'],
  },
  allowedDevOrigins: [
    "http://192.168.1.131:3001",
    "https://band-ending-charms-ends.trycloudflare.com",
  ],
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [
          {
            type: "host",
            value: "www.univerkstu.app",
          },
        ],
        destination: "https://univerkstu.app/:path*",
        permanent: true,
      },
      // Legacy `/curator` route — canonical curator workspace now lives under
      // `/group/curator`. Both routes worked simultaneously before; we 308
      // redirect to dedupe the entry point (permanent: true → HTTP 308 so the
      // method + body are preserved, matching Next's redirect semantics).
      {
        source: "/curator",
        destination: "/group/curator",
        permanent: true,
      },
      {
        source: "/curator/group/:groupKey",
        destination: "/group/curator/group/:groupKey",
        permanent: true,
      },
    ];
  },
  async headers() {
    const noindexHeader = [
      {
        key: 'X-Robots-Tag',
        value: 'noindex, nofollow, noarchive',
      },
    ];

    return [
      { source: '/admin', headers: noindexHeader },
      { source: '/admin/:path*', headers: noindexHeader },
      { source: '/schedule', headers: noindexHeader },
      { source: '/schedule/:path*', headers: noindexHeader },
      { source: '/exams', headers: noindexHeader },
      { source: '/exams/:path*', headers: noindexHeader },
      { source: '/grades', headers: noindexHeader },
      { source: '/grades/:path*', headers: noindexHeader },
      { source: '/umkd', headers: noindexHeader },
      { source: '/umkd/:path*', headers: noindexHeader },
      { source: '/profile', headers: noindexHeader },
      { source: '/profile/:path*', headers: noindexHeader },
      { source: '/settings', headers: noindexHeader },
      { source: '/settings/:path*', headers: noindexHeader },
      { source: '/support', headers: noindexHeader },
      { source: '/support/:path*', headers: noindexHeader },
      { source: '/group', headers: noindexHeader },
      { source: '/group/:path*', headers: noindexHeader },
      { source: '/teacher', headers: noindexHeader },
      { source: '/teacher/:path*', headers: noindexHeader },
      { source: '/chat', headers: noindexHeader },
      { source: '/chat/:path*', headers: noindexHeader },
      { source: '/starosta', headers: noindexHeader },
      { source: '/starosta/:path*', headers: noindexHeader },
      { source: '/grades-demo', headers: noindexHeader },
    ];
  },
};

export default nextConfig;
