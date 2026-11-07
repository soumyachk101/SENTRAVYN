/**
 * Pretest step: bundle the ESM client (and its shared-types import) into a
 * single file Node can load directly, so `node --test` can exercise the
 * built client without a package-level test framework. The source is
 * extensionless ESM (bundler output), which Node's ESM loader rejects raw,
 * so we inline everything here.
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: [`${here}/../src/index.ts`],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  // shared-types is a pure type module at runtime: no code to bundle, but
  // the import specifier still has to resolve, so leave it external and it
  // will simply type-check away.
  external: ['@sentravyn/shared-types'],
  outfile: `${here}/client.bundle.mjs`,
  logLevel: 'silent',
});

console.log('bundled api-client for testing');
