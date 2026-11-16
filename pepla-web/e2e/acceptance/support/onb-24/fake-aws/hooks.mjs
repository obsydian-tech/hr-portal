// Module hooks for the ONB-24 Lambda harness: every AWS SDK, AWS Encryption SDK, Postmark and Powertools
// import resolves to a fake in this folder, so the real handlers run with no network and no AWS account.
// Any AI client fails the import.
const HERE = new URL('./', import.meta.url);
const MAP = {
  '@aws-sdk/client-dynamodb': 'client-dynamodb.mjs',
  '@aws-sdk/lib-dynamodb': 'lib-dynamodb.mjs',
  '@aws-sdk/util-dynamodb': 'util-dynamodb.mjs',
  '@aws-sdk/client-kms': 'client-kms.mjs',
  '@aws-sdk/client-ssm': 'client-ssm.mjs',
  '@aws-sdk/client-cloudwatch': 'client-cloudwatch.mjs',
  '@aws-sdk/client-cognito-identity-provider': 'client-cognito-identity-provider.mjs',
  '@aws-crypto/client-node': 'aws-crypto.mjs',
  '@aws-crypto/decrypt-node': 'aws-crypto.mjs',
  'postmark': 'postmark.mjs',
  '@aws-lambda-powertools/logger': 'powertools.mjs',
  '@aws-lambda-powertools/tracer': 'powertools.mjs',
  '@aws-lambda-powertools/metrics': 'powertools.mjs',
};
const AI = /bedrock|textract|anthropic|openai|comprehend|rekognition|sagemaker/i;
export async function resolve(specifier, context, next) {
  if (MAP[specifier]) return { url: new URL(MAP[specifier], HERE).href, shortCircuit: true };
  if (AI.test(specifier)) return { url: new URL('refused.mjs', HERE).href + '?m=' + encodeURIComponent(specifier), shortCircuit: true };
  if (specifier.startsWith('@aws-sdk/') || specifier.startsWith('@aws-lambda-powertools/') || specifier.startsWith('@aws-crypto/')) {
    return { url: new URL('refused.mjs', HERE).href + '?m=' + encodeURIComponent(specifier), shortCircuit: true };
  }
  return next(specifier, context);
}
