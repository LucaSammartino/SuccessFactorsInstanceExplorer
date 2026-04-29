import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Resolves the git repository root from a file that lives under either:
 * - `scripts/manual/*.ts` (source)
 * - `dist-runtime/scripts/manual/*.js` (compiled)
 */
export function resolveRepoRootFromManualScriptDir(scriptDir: string): string {
  const twoUp = path.resolve(scriptDir, '..', '..');
  if (path.basename(twoUp) === 'dist-runtime') {
    return path.resolve(twoUp, '..');
  }
  return twoUp;
}

/**
 * Resolves repo root from `main.ts` / `dist-runtime/main.js` (or any entry file
 * that lives either at the repo root or inside `dist-runtime/`).
 */
export function resolveRepoRootFromEntrypoint(importMetaUrl: string): string {
  const dir = path.dirname(fileURLToPath(importMetaUrl));
  if (path.basename(dir) === 'dist-runtime') {
    return path.resolve(dir, '..');
  }
  return dir;
}
