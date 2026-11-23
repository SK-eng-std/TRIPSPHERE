import { build } from 'esbuild';

await build({
  entryPoints: ['api/index.ts'],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  platform: 'neutral',
  mainFields: ['module', 'main'],
  conditions: ['workerd', 'worker', 'browser'],
  outfile: 'dist-worker/index.js',
  external: ['node:*', 'cloudflare:*'],
  minify: true,
  logLevel: 'info',
});

console.log('Worker bundle written to dist-worker/index.js');
