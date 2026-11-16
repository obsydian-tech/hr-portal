// BE-17.1: copied unchanged from ../../be-17/fake-aws (BE-17 lock).
const m = new URL(import.meta.url).searchParams.get('m');
throw new Error(`BE-17 harness: ${m} has no fake. The fake AWS covers DynamoDB, KMS, S3 (and its URL signer), EventBridge, CloudWatch, Bedrock (refused), Secrets Manager, Cognito and Powertools.`);
