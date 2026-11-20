// CHAT-09: a "handler" that calls the chat Lambda's own lookup function directly, so AC-15 can see what resolveToolCall answers or
// throws without the model loop around it. The event names the lookup, its input and the caller context.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
export const handler = async (event) => {
  const { resolveToolCall } = await import(pathToFileURL(join(event.lambda, 'nalekoAiChat', 'tool-resolver.mjs')).href);
  try {
    return { ok: true, result: await resolveToolCall(event.tool, event.input ?? {}, event.context ?? {}) };
  } catch (e) {
    return { ok: false, error: { name: e?.name, message: String(e?.message ?? e) } };
  }
};
