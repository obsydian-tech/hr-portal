const m = new URL(import.meta.url).searchParams.get('m');
throw new Error(`ONB-07 harness: ${m} has no fake. The fake AWS covers DynamoDB, KMS, S3, EventBridge, Step Functions, CloudWatch, Textract, Bedrock, Postmark and Powertools.`);
