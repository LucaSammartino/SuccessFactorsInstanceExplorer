/**
 * Run backend + ensure UI bundle matches API (avoids stale ui/dist vs server ingest contract).
 * Set SUCCESSFACTORS_INSTANCE_EXPLORER_SKIP_UI_BUILD=1 to skip `npm --prefix ui run build` for faster iteration.
 */
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
process.chdir(root);

execSync('npm run build:runtime', { stdio: 'inherit' });
if (process.env.SUCCESSFACTORS_INSTANCE_EXPLORER_SKIP_UI_BUILD !== '1') {
  execSync('npm --prefix ui run build', { stdio: 'inherit' });
}
execSync('node dist-runtime/server.js', { stdio: 'inherit' });
