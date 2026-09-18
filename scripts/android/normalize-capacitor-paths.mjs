import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
const repo = resolve(import.meta.dirname, '../..');
const file = resolve(repo, 'apps/app-android/android/capacitor.settings.gradle');
const source = readFileSync(file, 'utf8');
const normalized = source.replace(/new File\('([^']*node_modules\/(@capacitor\/[^']+))'\)/g, (match, generated, dependency) => {
  const canonical = `../../../node_modules/${dependency}`;
  if (realpathSync(resolve(dirname(file), generated)) !== realpathSync(resolve(dirname(file), canonical))) {
    throw new Error('Capacitor dependency paths resolve to different installations; refusing to normalize.');
  }
  return `new File('${canonical}')`;
});
if (normalized !== source) writeFileSync(file, normalized);
console.log('Capacitor dependency paths verified and normalized');
