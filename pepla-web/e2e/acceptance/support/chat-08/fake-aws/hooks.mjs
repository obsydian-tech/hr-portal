// CHAT-08: one name only. The Bedrock client is this folder's model (bedrock-turns.mjs); everything else is CHAT-05's hooks.
const HERE = new URL('./', import.meta.url);
export async function resolve(specifier, context, next) {
  if (specifier === '@aws-sdk/client-bedrock-runtime') return { url: new URL('bedrock-turns.mjs', HERE).href, shortCircuit: true };
  return next(specifier, context);
}
