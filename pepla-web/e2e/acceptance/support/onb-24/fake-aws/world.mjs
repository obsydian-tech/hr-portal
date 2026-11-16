// ONB-24 fake AWS: the world (read from the file named by ONB24_WORLD) and every call the fakes answer.
// world = { fail: { postmark?: true, signOut?: true }, tables: { <name>: [rows] } }
import { readFileSync } from 'node:fs';
export const world = JSON.parse(readFileSync(process.env.ONB24_WORLD, 'utf8'));
world.fail ??= {};
world.tables ??= {};
export const calls = [];
export function awsError(name, message) {
  const e = new Error(message ?? name);
  e.name = name;
  e.$fault = 'client';
  e.$metadata = { httpStatusCode: 400 };
  return e;
}
