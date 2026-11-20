/**
 * CHAT-02: a person's stored Ask Batsi chats.
 *
 *   GET    /v1/chats          the person's chats, newest use first, 50 to a page (?nextToken=)
 *   GET    /v1/chats/{id}     one chat with every message; another person's, another company's or a made-up id is 404
 *   DELETE /v1/chats/{id}     deletes it, header and every message, for real
 *   DELETE /v1/chats          deletes every chat of the signed-in person
 *
 * Who: hr_staff (or the old Talent Flow HR group), with a company on the sign-in. The company and the person come from the
 * sign-in only; nothing in the body, query, path or headers names either. Reading and listing need the company's Ask Batsi
 * switch on (403 when off). Deleting does not: chats are kept while the switch is off, so a person must still be able to
 * erase theirs. None of these routes calls a model, so they work with AI switched off.
 *
 * Logs hold error names only: never a title, a message, an id or an AWS message. No tracing of bodies.
 */
import { PutItemCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { inGroup, json } from '../shared/hr-group.mjs';
import { notFound, requireTenant } from '../shared/tenant.mjs';
import { requireModule } from '../shared/modules.mjs';
import { BadPageToken, deleteAllChats, deleteChat, getChat, isChatId, listChats, ownerKey } from '../shared/ask-batsi-chats.mjs';

const dynamo = new DynamoDBClient({});

const noStore = (res) => ({ ...res, headers: { ...res.headers, 'Cache-Control': 'private, no-store' } });

/** One content-free audit row: who, when and which chat. Never what was in it. */
async function audit(fields) {
  try {
    await dynamo.send(new PutItemCommand({
      TableName: process.env.AGENT_AUDIT_TABLE,
      Item: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, { S: v }])),
    }));
  } catch (err) {
    console.error('Chat audit write failed', { error: err?.name ?? 'Error' });
  }
}

export const handler = async (event) => {
  try {
    const claims = event?.requestContext?.authorizer?.jwt?.claims ?? {};
    if (!inGroup(claims, 'hr_staff', 'naleko-talentflow-hr')) return json(403, { error: 'Forbidden' });
    const { tenantId, refusal } = requireTenant(event);
    if (refusal) return refusal;
    const staffId = claims['custom:staff_id'] || claims.sub;
    if (typeof staffId !== 'string' || staffId === '') return json(403, { error: 'Forbidden' });

    const route = event?.routeKey ?? `${event?.requestContext?.http?.method} ${event?.rawPath}`;
    const id = event?.pathParameters?.id;

    if (route === 'DELETE /v1/chats/{id}') {
      if (!isChatId(id)) return notFound();
      if (!(await deleteChat(tenantId, staffId, id))) return notFound();
      await audit({ pk: ownerKey(tenantId, staffId), sk: new Date().toISOString(), action: 'CHAT_DELETED', conversation_id: id, staffId, tenant_id: tenantId });
      return json(200, { deleted: true });
    }
    if (route === 'DELETE /v1/chats') {
      await deleteAllChats(tenantId, staffId);
      await audit({ pk: ownerKey(tenantId, staffId), sk: new Date().toISOString(), action: 'CHATS_DELETED_ALL', staffId, tenant_id: tenantId });
      return json(200, { deleted: true });
    }

    if (route === 'GET /v1/chats' || route === 'GET /v1/chats/{id}') {
      const off = await requireModule(event, 'ask_batsi');
      if (off) return off;
      if (route === 'GET /v1/chats') {
        return noStore(json(200, await listChats(tenantId, staffId, event?.queryStringParameters?.nextToken)));
      }
      if (!isChatId(id)) return notFound();
      const chat = await getChat(tenantId, staffId, id);
      return chat ? noStore(json(200, chat)) : notFound();
    }
    return notFound();
  } catch (err) {
    if (err instanceof BadPageToken) return json(400, { error: 'Bad request' });
    console.error('Chat route failed', { error: err?.name ?? 'Error' });
    return json(500, { error: 'Something went wrong' });
  }
};
