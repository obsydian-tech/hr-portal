// CHAT-02: copied from ../../mod-01/fake-aws (code added only): Bedrock answers from a script in the world (bedrock-scripted.mjs); a Query pages, honours ExclusiveStartKey and ScanIndexForward; BatchWriteItem takes at most 25.
// MOD-01: copied from ../../ten-03/fake-aws (code added only: STS, credential helpers, the prod company list, a clock
// and sets in helper-run.mjs, an empty set removed by DELETE). Nothing reaches AWS; any AI client is refused.
// TEN-03: copied from ../../ten-01/fake-aws; Postmark, Step Functions and a working Cognito added.
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
  '@aws-sdk/client-bedrock-runtime': 'bedrock-scripted.mjs',
  '@aws-sdk/client-secrets-manager': 'client-secrets-manager.mjs',
  '@aws-sdk/client-cognito-identity-provider': 'client-cognito.mjs',
  // TEN-03: the invite routes send email through Postmark and createEmployee may call Step Functions.
  '@aws-sdk/client-sfn': 'client-sfn.mjs',
  'postmark': 'postmark.mjs',
  // TEN-03: processDocumentOCR (AC-5) imports Textract at start; every send fails.
  '@aws-sdk/client-textract': 'textract-refused.mjs',
  // TEN-03: the TalentFlow handlers also use SQS, Lambda invoke and the ulid package.
  '@aws-sdk/client-sqs': 'client-sqs.mjs',
  '@aws-sdk/client-lambda': 'client-lambda.mjs',
  'ulid': 'ulid.mjs',
  // MOD-01: the module script asks STS who runs it (the audit row's `by`) and may take credentials from a profile.
  '@aws-sdk/client-sts': 'client-sts.mjs',
  '@aws-sdk/credential-providers': 'credential-providers.mjs',
  '@aws-sdk/credential-provider-ini': 'credential-providers.mjs',
  '@aws-sdk/credential-provider-node': 'credential-providers.mjs',
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
