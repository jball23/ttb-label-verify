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
  experimental: {
    serverActions: {
      bodySizeLimit: '300mb',
    },
  },
};

export default nextConfig;
