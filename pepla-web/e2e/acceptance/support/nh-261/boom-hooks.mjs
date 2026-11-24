// NH-261 AC-5: the Powertools logger and tracer resolve to throwing stand-ins when NH261_BOOM=powertools.
const HERE = new URL('./', import.meta.url);
export async function resolve(specifier, context, next) {
  if (process.env.NH261_BOOM === 'powertools' && (specifier === '@aws-lambda-powertools/logger' || specifier === '@aws-lambda-powertools/tracer')) {
    return { url: new URL('boom-powertools.mjs', HERE).href, shortCircuit: true };
  }
  return next(specifier, context);
}
