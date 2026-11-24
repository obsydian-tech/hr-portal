import { withB } from '../ten-03/checks';
/**
 * Child lock rec-15b.1 (REC-15 step B): TEN-03's withB names company B in the query, the headers and the body. REC-15 rule 19 refuses any
 * unknown body key on POST /v1/candidates (a company there is a 400, which ten-03 AC-4 now checks on its own), so the "names B everywhere a
 * client could" case for that route names B in the query and the headers only.
 */
export function withBOutsideBody<T extends { body?: unknown }>(a: T): T {
  const b = withB(a as any) as T;
  return { ...b, body: a.body };
}
