import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';

const ENV_FILE = resolve(process.cwd(), '.env');

const seedHex = randomBytes(32).toString('hex');

let lines = [];
if (existsSync(ENV_FILE)) {
  lines = readFileSync(ENV_FILE, 'utf8').split('\n');
}

let found = false;
const out = lines.map((line) => {
  if (line.startsWith('WALLET_SEED=')) {
    found = true;
    return `WALLET_SEED=${seedHex}`;
  }
  return line;
});
if (!found) {
  if (out.length && out[out.length - 1] === '') out.pop();
  out.push(`WALLET_SEED=${seedHex}`);
  out.push('');
}

writeFileSync(ENV_FILE, out.join('\n'));
chmodSync(ENV_FILE, 0o600);

console.log('Seed generated and written to .env');
