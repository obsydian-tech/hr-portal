const m = new URL(import.meta.url).searchParams.get('m');
throw new Error(`ONB-24 harness: ${m} has no fake here (AI services are never allowed). The fake covers DynamoDB, Cognito, KMS, SSM, CloudWatch, the AWS Encryption SDK, Postmark and Powertools.`);
