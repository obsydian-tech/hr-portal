import { TextractClient, AnalyzeDocumentCommand } from "@aws-sdk/client-textract";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { DynamoDBClient, PutItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';

const textract = new TextractClient({ region: "eu-west-1" });
const s3 = new S3Client();
const bedrock = new BedrockRuntimeClient({ region: "af-south-1" });
const dynamodb = new DynamoDBClient();

const logger = new Logger({ serviceName: 'processDocumentOCR' });
const tracer = new Tracer({ serviceName: 'processDocumentOCR' });

// ─── Prompt builders per document type ────────────────────────

function buildNationalIdPrompt(extractedText) {
  return `You are a South African ID document validator. Analyze the following extracted text from an ID document and return ONLY valid JSON (no markdown, no code blocks).

Extracted text:
${extractedText}

Validate these rules:
1. Is there a 13-digit SA ID number?
2. Do the first 6 digits match the date of birth (YYMMDD)?
3. Is the gender code correct? (digits 7-10: 0000-4999 = female, 5000-9999 = male)
4. Is the citizenship digit valid? (digit 11: 0 = SA citizen, 1 = permanent resident)
5. Is a name present?
6. Is a surname present?

Return this exact JSON structure:
{
  "idNumber": "the 13 digit ID found or null",
  "name": "name found or null",
  "surname": "surname found or null",
  "dateOfBirth": "DOB found or null",
  "gender": "Male or Female based on ID number",
  "citizenship": "SA Citizen or Permanent Resident",
  "checks": {
    "hasValidIdLength": true/false,
    "dobMatchesId": true/false,
    "genderCodeValid": true/false,
    "citizenshipDigitValid": true/false,
    "hasName": true/false,
    "hasSurname": true/false
  },
  "confidence": a number between 0 and 100,
  "decision": "AUTO_APPROVE" if confidence >= 90 or "MANUAL_REVIEW" if confidence < 90,
  "reasoning": "brief explanation"
}`;
}

function buildBankConfirmationPrompt(extractedText) {
  return `You are a South African bank confirmation letter validator. Analyze the following extracted text from a bank-issued account confirmation letter and return ONLY valid JSON (no markdown, no code blocks).

Extracted text:
${extractedText}

Validate these rules:
1. Is there an account holder name?
2. Is a recognised South African bank name present? (e.g. FNB, ABSA, Standard Bank, Nedbank, Capitec, TymeBank, African Bank, Discovery Bank, Investec)
3. Is there a bank account number?
4. Is there a branch code (or universal branch code)?
5. Is the account type mentioned? (e.g. Cheque, Savings, Transmission, Current)
6. Does the letter appear to be recent (date within the last 3 months)?

Return this exact JSON structure:
{
  "accountHolder": "name on the letter or null",
  "bankName": "bank name found or null",
  "accountNumber": "account number found or null",
  "branchCode": "branch code found or null",
  "accountType": "account type found or null",
  "checks": {
    "hasAccountHolder": true/false,
    "hasBankName": true/false,
    "hasAccountNumber": true/false,
    "hasBranchCode": true/false,
    "hasAccountType": true/false,
    "isRecentLetter": true/false
  },
  "confidence": a number between 0 and 100,
  "decision": "AUTO_APPROVE" if confidence >= 90 or "MANUAL_REVIEW" if confidence < 90,
  "reasoning": "brief explanation"
}`;
}

function buildGenericPrompt(extractedText, documentType) {
  return `You are a document validator. Analyze the following extracted text from a "${documentType}" document and return ONLY valid JSON (no markdown, no code blocks).

Extracted text:
${extractedText}

Determine if this looks like a legitimate "${documentType}" document.

Return this exact JSON structure:
{
  "documentTypeDetected": "what type of document this appears to be",
  "checks": {
    "appearsLegitimate": true/false,
    "isReadable": true/false
  },
  "confidence": a number between 0 and 100,
  "decision": "AUTO_APPROVE" if confidence >= 90 or "MANUAL_REVIEW" if confidence < 90,
  "reasoning": "brief explanation"
}`;
}

function getPromptForDocType(documentType, extractedText) {
  switch (documentType) {
    case "NATIONAL_ID":
      return buildNationalIdPrompt(extractedText);
    case "BANK_CONFIRMATION":
      return buildBankConfirmationPrompt(extractedText);
    default:
      return buildGenericPrompt(extractedText, documentType);
  }
}

// ─── DynamoDB item builder per document type ──────────────────

function buildVerificationItem({ verificationId, employeeId, documentId, documentType, key, validationResult, ocrCompletedAt }) {
  // Common fields for all document types
  const item = {
    verificationId: { S: verificationId },
    employeeId: { S: employeeId },
    documentId: { S: `doc_${documentId}` },
    documentType: { S: documentType },
    fileName: { S: key },
    checks: { S: JSON.stringify(validationResult.checks || {}) },
    confidence: { N: String(validationResult.confidence) },
    decision: { S: validationResult.decision },
    reasoning: { S: validationResult.reasoning },
    createdAt: { S: ocrCompletedAt },
  };

  if (documentType === "NATIONAL_ID") {
    item.idNumber = { S: validationResult.idNumber || "NOT_FOUND" };
    item.name = { S: validationResult.name || "NOT_FOUND" };
    item.surname = { S: validationResult.surname || "NOT_FOUND" };
    item.dateOfBirth = { S: validationResult.dateOfBirth || "NOT_FOUND" };
    item.gender = { S: validationResult.gender || "NOT_FOUND" };
    item.citizenship = { S: validationResult.citizenship || "NOT_FOUND" };
  } else if (documentType === "BANK_CONFIRMATION") {
    item.accountHolder = { S: validationResult.accountHolder || "NOT_FOUND" };
    item.bankName = { S: validationResult.bankName || "NOT_FOUND" };
    item.accountNumber = { S: validationResult.accountNumber || "NOT_FOUND" };
    item.branchCode = { S: validationResult.branchCode || "NOT_FOUND" };
    item.accountType = { S: validationResult.accountType || "NOT_FOUND" };
  }

  return item;
}

// ─── Main handler ─────────────────────────────────────────────

const handlerFn = async (event) => {
  const bucket = event.Records[0].s3.bucket.name;
  const key = decodeURIComponent(event.Records[0].s3.object.key.replace(/\+/g, " "));

  logger.info('Processing document', { key, bucket });
  tracer.putAnnotation('operation', 'processDocumentOCR');

  try {
    // 1. Extract metadata from S3 key
    // Format: uploads/EMP-0000011/NATIONAL_ID/doc_1774086521598_sarah_id.pdf
    const keyParts = key.split('/');
    const employeeId = keyParts[1];
    const documentType = keyParts[2];
    const fileName = keyParts[3];
    const documentId = fileName.split('_')[1]; // Extract doc_1774086521598

    logger.info('Document metadata', { employeeId, documentType, documentId });
    tracer.putAnnotation('employeeId', employeeId);
    tracer.putAnnotation('documentType', documentType);

    // 2. Download file from S3
    const s3Response = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: key })
    );
    const fileBytes = await s3Response.Body.transformToByteArray();
    logger.info('File downloaded', { bytes: fileBytes.length });

    // 3. Extract text with Textract
    const textractResponse = await textract.send(
      new AnalyzeDocumentCommand({
        Document: { Bytes: fileBytes },
        FeatureTypes: ["FORMS"],
      })
    );

    const extractedLines = textractResponse.Blocks
      .filter((block) => block.BlockType === "LINE")
      .map((block) => block.Text);

    const extractedText = extractedLines.join("\n");
    // NOTE: extracted text is not logged to avoid PII (may contain names, ID numbers, account details)

    // 4. Send to Claude for validation — prompt varies by document type
    const prompt = getPromptForDocType(documentType, extractedText);
    logger.info('Running Claude validation', { documentType });

    const claudeResponse = await bedrock.send(
      new InvokeModelCommand({
        modelId: "global.anthropic.claude-haiku-4-5-20251001-v1:0",
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify({
          anthropic_version: "bedrock-2023-05-31",
          max_tokens: 1024,
          messages: [
            { role: "user", content: prompt }
          ],
        }),
      })
    );

    // 5. Parse Claude's response
    const claudeBody = JSON.parse(new TextDecoder().decode(claudeResponse.body));
    let claudeText = claudeBody.content[0].text;
    claudeText = claudeText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const validationResult = JSON.parse(claudeText);

    // NOTE: full validation result not logged to avoid PII (may contain idNumber, name, accountHolder, etc.)
    logger.info('Validation complete', { confidence: validationResult.confidence, decision: validationResult.decision });

    // 6. Save to document-verification table — fields vary by document type
    const verificationId = `ver_${Date.now()}`;
    const ocrCompletedAt = new Date().toISOString();

    const verificationItem = buildVerificationItem({
      verificationId, employeeId, documentId, documentType, key, validationResult, ocrCompletedAt,
    });

    await dynamodb.send(
      new PutItemCommand({
        TableName: "document-verification",
        Item: verificationItem,
      })
    );

    logger.info('Saved verification record', { verificationId });

    // 7. Update documents table with OCR status
    const ocrStatus = validationResult.confidence >= 90 ? "PASSED" : "MANUAL_REVIEW";

    await dynamodb.send(
      new UpdateItemCommand({
        TableName: "documents",
        Key: {
          employee_id: { S: employeeId },
          document_id: { S: `doc_${documentId}` }
        },
        UpdateExpression: "SET ocr_status = :status, ocr_completed_at = :completedAt, verification_id = :verificationId",
        ExpressionAttributeValues: {
          ":status": { S: ocrStatus },
          ":completedAt": { S: ocrCompletedAt },
          ":verificationId": { S: verificationId }
        }
      })
    );

    logger.info('Updated document status', { documentId, ocrStatus });

    // 8. Return the result
    return {
      statusCode: 200,
      body: {
        verificationId,
        documentId: `doc_${documentId}`,
        employeeId,
        ocrStatus,
        confidence: validationResult.confidence,
        decision: validationResult.decision
      },
    };
  } catch (error) {
    logger.error('Error processing document', { error });
    
    // Try to mark document as FAILED if we can extract the document_id
    try {
      const keyParts = key.split('/');
      const employeeId = keyParts[1];
      const fileName = keyParts[3];
      const documentId = fileName.split('_')[1];
      
      await dynamodb.send(
        new UpdateItemCommand({
          TableName: "documents",
          Key: {
            employee_id: { S: employeeId },
            document_id: { S: `doc_${documentId}` }
          },
          UpdateExpression: "SET ocr_status = :status, ocr_completed_at = :completedAt",
          ExpressionAttributeValues: {
            ":status": { S: "FAILED" },
            ":completedAt": { S: new Date().toISOString() }
          }
        })
      );
      
      logger.warn('Marked document as FAILED', { documentId });
    } catch (updateError) {
      logger.error('Failed to update document status', { error: updateError });
    }
    
    throw error;
  }
};

export const handler = tracer.captureLambdaHandler(handlerFn);