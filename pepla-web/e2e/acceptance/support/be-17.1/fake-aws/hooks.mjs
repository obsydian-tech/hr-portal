// BE-17.1: copied unchanged from ../../be-17/fake-aws (BE-17 lock).
// BE-17: copied from ../../onb-15/fake-aws; Bedrock, Secrets Manager and Cognito get recording fakes.
// Module hooks for the ONB-15 Lambda harness: every AWS SDK and Powertools import resolves to a fake in
// this folder, so the real handlers run with no network, no AWS account and nothing installed.
// Copied from ../../onb-07/fake-aws (ONB-07 lock) and cut down: the three document routes need DynamoDB,
// KMS, S3 with its URL signer, EventBridge, CloudWatch and Powertools. Any AI client fails the import.
const HERE = new URL('./', import.meta.url);
const MAP = {
  '@aws-sdk/client-dynamodb': 'client-dynamodb.mjs',
  '@aws-sdk/lib-dynamodb': 'lib-dynamodb.mjs',
  '@aws-sdk/util-dynamodb': 'util-dynamodb.mjs',
  '@aws-sdk/client-kms': 'client-kms.mjs',
  '@aws-sdk/client-s3': 'client-s3.mjs',
  '@aws-sdk/s3-request-presigner': 's3-request-presigner.mjs',
  '@aws-sdk/client-eventbridge': 'client-eventbridge.mjs',
  '@aws-sdk/client-cloudwatch': 'client-cloudwatch.mjs',
  '@aws-lambda-powertools/logger': 'powertools.mjs',
  '@aws-lambda-powertools/tracer': 'powertools.mjs',
  '@aws-lambda-powertools/metrics': 'powertools.mjs',
  // BE-17: the AI routes import the Bedrock client at start. The fake records every send and fails it,
  // so a model call fails the run (the AI guard refuses robots before send, so a correct run makes none).
  '@aws-sdk/client-bedrock-runtime': 'bedrock-refused.mjs',
  '@aws-sdk/client-secrets-manager': 'client-secrets-manager.mjs',
  '@aws-sdk/client-cognito-identity-provider': 'client-cognito.mjs',
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
