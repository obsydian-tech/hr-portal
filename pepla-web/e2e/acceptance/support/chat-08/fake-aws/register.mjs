// CHAT-08: CHAT-05's module hooks (../../chat-05/fake-aws, used as they are), then this folder's: the hooks registered last
// run first, so only the Bedrock client resolves to this folder's model (bedrock-turns.mjs); every other name goes on to CHAT-05's.
import { register } from 'node:module';
register('../../chat-05/fake-aws/hooks.mjs', import.meta.url);
register('./hooks.mjs', import.meta.url);
