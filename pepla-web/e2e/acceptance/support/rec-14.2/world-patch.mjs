// REC-14 step B: a preload (NODE_OPTIONS --import) that lets a test set what the fake AWS of ../rec-14/fake-aws keeps outside the
// tables: the sign-in pool's users for a helper run, and `cognitoFail` (operation names that fail with a 500 from Cognito).
// It reads REC14_WORLD_PATCH (JSON) and copies each key onto the fake's world. Test support only; no application code.
import { world } from '../rec-14/fake-aws/world.mjs';

const patch = process.env.REC14_WORLD_PATCH ? JSON.parse(process.env.REC14_WORLD_PATCH) : {};
for (const [key, value] of Object.entries(patch)) world[key] = value;
