// BE-20 (new): a stub route wrapped in a real withIdempotency, so a test can call either copy directly.
// The copy is named by BE20_IDEM_FILE. The stub logs "be20 stub ran" each time it runs, and answers 200.
import { pathToFileURL } from 'node:url';
const { withIdempotency } = await import(pathToFileURL(process.env.BE20_IDEM_FILE).href);
export const handler = async (event) => withIdempotency(event.headers?.['idempotency-key'], async () => {
  console.log('be20 stub ran');
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true }) };
});
