/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep these out of the webpack bundle on the server side — they ship native
  // binaries or rely on Node runtime features and must be require()'d at runtime
  // by the route handler, not bundled into the build output.
  // Keep the server-side rendering deps as runtime require()s so pdfjs can
  // resolve its own worker file via node_modules, and so @napi-rs/canvas's
  // native binary isn't pulled into the webpack chunk.
  serverExternalPackages: ['@napi-rs/canvas', 'pdfjs-dist'],
  // react-pdf must flow through Next's transpiler so the client bundle
  // initializes cleanly. (Its nested pdfjs-dist is a different physical copy
  // from the top-level server-side one, so there's no conflict.)
  transpilePackages: ['react-pdf'],
  // src/lib/pdf/render.ts intentionally computes the pdfjs worker + standard-
  // fonts paths via `process.cwd() + path.join(...)` so webpack's static
  // analyzer can't rewrite them. Vercel's Node File Tracer (nft) likewise
  // can't see those runtime-computed paths, so it skips copying the files
  // into the /var/task/ function bundle and the route 500s with "Cannot find
  // module .../pdf.worker.mjs". Force-include them here so nft ships the
  // worker, the pdfjs entry, and the standard_fonts dir alongside the
  // /api/verify lambda.
  outputFileTracingIncludes: {
    '/api/verify': [
      './node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
      './node_modules/pdfjs-dist/legacy/build/pdf.mjs',
      './node_modules/pdfjs-dist/standard_fonts/**',
    ],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '300mb',
    },
  },
};

export default nextConfig;
