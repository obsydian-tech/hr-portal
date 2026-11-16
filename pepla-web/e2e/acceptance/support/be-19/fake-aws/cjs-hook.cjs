// BE-19: new. The old admin, IT and provisioning Lambdas are CommonJS, and require() does not go through
// the ESM hooks in hooks.mjs. This preload (node --require) sends the same AWS SDK names to the same fakes
// in this folder (loaded with require of an ES module, Node 22), so the CommonJS handlers share the one fake
// world with run.mjs. Any other @aws-sdk or Powertools name, and any AI client, is refused.
const Module = require('node:module');
const path = require('node:path');
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
  '@aws-sdk/client-bedrock-runtime': 'bedrock-refused.mjs',
  '@aws-sdk/client-secrets-manager': 'client-secrets-manager.mjs',
  '@aws-sdk/client-cognito-identity-provider': 'client-cognito.mjs',
};
const AI = /bedrock|textract|anthropic|openai|comprehend|rekognition|sagemaker/i;
const original = Module._resolveFilename;
Module._resolveFilename = function resolve(request, ...rest) {
  if (MAP[request]) return path.join(__dirname, MAP[request]);
  if (AI.test(request)) return path.join(__dirname, 'ai-refused.mjs');
  if (request.startsWith('@aws-sdk/') || request.startsWith('@aws-lambda-powertools/')) return path.join(__dirname, 'unknown-aws.mjs');
  return original.call(this, request, ...rest);
};
