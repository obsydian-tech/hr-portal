// REC-09: test support only. A one-line "handler" so the shared recipients file runs in a fresh process under the fake AWS.
// event = { tenantId, target, context }  ->  the sorted list of people ids, or { threw }.
export const handler = async (event) => {
  const m = await import(new URL('../../../../../lambda/shared/recipients.mjs', import.meta.url).href);
  try {
    return { ids: await m.resolveRecipients(event.tenantId, event.target, event.context ?? {}) };
  } catch (e) {
    return { threw: String(e?.name ?? e) };
  }
};
