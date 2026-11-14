const m = new URL(import.meta.url).searchParams.get('m');
throw new Error(`ONB-15 harness: ${m} has no fake. The fake AWS covers DynamoDB, KMS, S3 (and its URL signer), EventBridge, CloudWatch and Powertools.`);
