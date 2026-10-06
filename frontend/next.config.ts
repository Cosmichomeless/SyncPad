import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@syncpad/shared'],
  // The container image sets NEXT_OUTPUT=standalone. The repository root is the tracing
  // root because @syncpad/shared lives outside frontend/. Plain `next build` is unchanged.
  ...(process.env.NEXT_OUTPUT === 'standalone'
    ? { output: 'standalone' as const, outputFileTracingRoot: path.resolve(process.cwd(), '..') }
    : {}),
};

export default nextConfig;
