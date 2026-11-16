// TEN-07: copied from ../../be-17/fake-aws (BE-17 tests) and cut down to what configRegionCheck needs.
// Every AWS SDK import resolves to a file in this folder, so the real handler runs with no network, no AWS
// account and nothing installed. The only fake client is AWS Config; any other AWS client fails the import,
// and any AI client fails it with its own message.
const HERE = new URL('./', import.meta.url);
const MAP = {
  '@aws-sdk/client-config-service': 'client-config-service.mjs',
};
const AI = /bedrock|textract|anthropic|openai|comprehend|rekognition|sagemaker/i;

export async function resolve(specifier, context, next) {
  if (MAP[specifier]) return { url: new URL(MAP[specifier], HERE).href, shortCircuit: true };
  if (AI.test(specifier)) return { url: new URL('ai-refused.mjs', HERE).href + '?m=' + encodeURIComponent(specifier), shortCircuit: true };
  if (specifier.startsWith('@aws-sdk/') || specifier.startsWith('@aws-lambda-powertools/')) {
    return { url: new URL('unknown-aws.mjs', HERE).href + '?m=' + encodeURIComponent(specifier), shortCircuit: true };
  }
  return next(specifier, context);
}
