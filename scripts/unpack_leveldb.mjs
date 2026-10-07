// Unpack a Foundry LevelDB compendium to one JSON file per document, for map_library.py.
// Runs as a child process so the native classic-level binding loads here and nowhere else.
//
//   node unpack_leveldb.mjs <packDir> <destDir>
//
// Resolves @foundryvtt/foundryvtt-cli from this repo's node_modules regardless of cwd.
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [packDir, destDir] = process.argv.slice(2);
if (!packDir || !destDir) {
  console.error('usage: node unpack_leveldb.mjs <packDir> <destDir>');
  process.exit(2);
}
const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(here, '..', 'package.json'));
const cliPath = require.resolve('@foundryvtt/foundryvtt-cli');
const cli = await import(pathToFileURL(cliPath).href);
await cli.extractPack(packDir, destDir, { log: false });
