const m = new URL(import.meta.url).searchParams.get('m');
throw new Error(`ONB-03 harness: ${m} has no fake. The fake AWS covers DynamoDB, Cognito (user pool), KMS, S3, EventBridge, Step Functions, CloudWatch, Textract, Bedrock, Postmark and Powertools.`);
