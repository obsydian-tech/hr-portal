// Module hooks for the ONB-07 Lambda harness: every AWS SDK, Postmark and Powertools import resolves to
// a fake in this folder, so the real handlers run with no network, no AWS account and nothing installed.
// Textract and Bedrock are fakes that record every attempt (ai-fake.mjs). Any other AI client fails the import.
const HERE = new URL('./', import.meta.url);
const MAP = {
  '@aws-sdk/client-dynamodb': 'client-dynamodb.mjs',
  '@aws-sdk/lib-dynamodb': 'lib-dynamodb.mjs',
  '@aws-sdk/util-dynamodb': 'util-dynamodb.mjs',
  '@aws-sdk/client-kms': 'client-kms.mjs',
  '@aws-sdk/client-s3': 'client-s3.mjs',
  '@aws-sdk/client-eventbridge': 'client-eventbridge.mjs',
  '@aws-sdk/client-sfn': 'client-sfn.mjs',
  '@aws-sdk/client-cloudwatch': 'client-cloudwatch.mjs',
  '@aws-sdk/client-textract': 'client-textract.mjs',
  '@aws-sdk/client-bedrock-runtime': 'client-bedrock-runtime.mjs',
  'postmark': 'postmark.mjs',
  '@aws-lambda-powertools/logger': 'powertools.mjs',
  '@aws-lambda-powertools/tracer': 'powertools.mjs',
  '@aws-lambda-powertools/metrics': 'powertools.mjs',
};
const OTHER_AI = /bedrock|textract|anthropic|openai|comprehend|rekognition|sagemaker/i;

export async function resolve(specifier, context, next) {
  if (MAP[specifier]) return { url: new URL(MAP[specifier], HERE).href, shortCircuit: true };
  if (OTHER_AI.test(specifier)) return { url: new URL('ai-refused.mjs', HERE).href + '?m=' + encodeURIComponent(specifier), shortCircuit: true };
  if (specifier.startsWith('@aws-sdk/') || specifier.startsWith('@aws-lambda-powertools/')) {
    return { url: new URL('unknown-aws.mjs', HERE).href + '?m=' + encodeURIComponent(specifier), shortCircuit: true };
  }
  return next(specifier, context);
}
