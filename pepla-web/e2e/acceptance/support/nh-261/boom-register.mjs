// NH-261 AC-5: registered after ../rec-14/fake-aws/register.mjs, so these hooks run first. They swap the Powertools
// logger and tracer for stand-ins that throw the planted error (boom-powertools.mjs); every other import goes on to the
// REC-14 fake AWS unchanged. Used only by boom-run.mjs.
import { register } from 'node:module';
register('./boom-hooks.mjs', import.meta.url);
