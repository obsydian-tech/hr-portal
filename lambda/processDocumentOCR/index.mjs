import { TextractClient, AnalyzeDocumentCommand } from "@aws-sdk/client-textract";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { DynamoDBClient, PutItemCommand, UpdateItemCommand, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { SFNClient, SendTaskSuccessCommand } from "@aws-sdk/client-sfn";
import { KMSClient, EncryptCommand } from "@aws-sdk/client-kms";
import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { guardAi, isRobotEmail, markRobot, aiSwitchedOff, AI_SKIPPED_LABEL, AI_OFF_LABEL } from '../shared/ai-guard.mjs';
import { checkFromRead } from '../shared/document-check.mjs';

const textract = guardAi(new TextractClient({ region: "eu-west-1" }), "textract");
const s3 = new S3Client();
const bedrock = guardAi(new BedrockRuntimeClient({ region: "af-south-1" }), "bedrock");
const dynamodb = new DynamoDBClient();
const sfn = new SFNClient({ region: 'af-south-1' });
const kms = new KMSClient();
const eb = new EventBridgeClient();

const logger = new Logger({ serviceName: 'processDocumentOCR' });
const tracer = new Tracer({ serviceName: 'processDocumentOCR' });

async function publishEvent(detailType, detail) {
  if (!process.env.EVENT_BUS_NAME) return;
  try {
    await eb.send(new PutEventsCommand({
      Entries: [{
        EventBusName: process.env.EVENT_BUS_NAME,
        Source: 'naleko.onboarding',
        DetailType: detailType,
        Detail: JSON.stringify(detail),
      }],
    }));
  } catch (err) {
    logger.warn('EventBridge publish failed', { detailType, error: err.message });
  }
}

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

/**
 * KMS envelope encryption — returns base64 ciphertext.
 * Falls back to null if KMS_KEY_ARN is not set (unit test / local).
 */
async function kmsEncrypt(plaintext) {
  if (!process.env.KMS_KEY_ARN || !plaintext || plaintext === 'NOT_FOUND') return null;
  const result = await kms.send(new EncryptCommand({
    KeyId: process.env.KMS_KEY_ARN,
    Plaintext: Buffer.from(plaintext, 'utf8'),
  }));
  return Buffer.from(result.CiphertextBlob).toString('base64');
}

async function buildVerificationItem({ verificationId, employeeId, documentId, documentType, key, validationResult, check, ocrCompletedAt }) {
  // Common fields for all document types
  const item = {
    verificationId: { S: verificationId },
    employeeId: { S: employeeId },
    documentId: { S: `doc_${documentId}` },
    documentType: { S: documentType },
    fileName: { S: key },
    checks: { S: JSON.stringify(validationResult.checks || {}) },
    confidence: { N: String(validationResult.confidence) },
    // ONB-07: every read document waits for HR. The model's own decision is never stored.
    decision: { S: 'MANUAL_REVIEW' },
    check: { S: check },
    reasoning: { S: validationResult.reasoning || '' },
    createdAt: { S: ocrCompletedAt },
  };

  if (documentType === "NATIONAL_ID") {
    // NH-11: encrypt SA ID number; store only ciphertext + last 4 in plain
    const rawIdNumber = validationResult.idNumber || null;
    const encrypted = await kmsEncrypt(rawIdNumber);
    if (encrypted) {
      item.idNumber_encrypted = { S: encrypted };
      item.idNumber_last4 = { S: String(rawIdNumber).slice(-4) };
    } else {
      // Fallback: KMS unavailable (dev/test) — store sentinel instead of plaintext
      item.idNumber_encrypted = { S: 'KMS_UNAVAILABLE' };
      item.idNumber_last4 = { S: rawIdNumber ? String(rawIdNumber).slice(-4) : 'XXXX' };
    }
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

const EMPLOYEES_TABLE = () => process.env.EMPLOYEES_TABLE ?? 'employees';

/**
 * ONB-07: tell HR once. hr_told_at is set with a condition that it is not set yet; only the write that
 * succeeds publishes document.waiting, so a repeat of the same S3 event never tells HR twice.
 */
async function tellHrOnce({ employeeId, documentId, documentType, check }) {
  try {
    await dynamodb.send(new UpdateItemCommand({
      TableName: "documents",
      Key: { employee_id: { S: employeeId }, document_id: { S: `doc_${documentId}` } },
      UpdateExpression: "SET hr_told_at = :now",
      ConditionExpression: "attribute_not_exists(hr_told_at)",
      ExpressionAttributeValues: { ":now": { S: new Date().toISOString() } },
    }));
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      logger.info('HR already told about this document', { documentId });
      return;
    }
    throw err;
  }
  await publishEvent('document.waiting', {
    employee_id: employeeId,
    document_id: `doc_${documentId}`,
    document_type: documentType,
    check,
  });
}

const handlerFn = async (event) => {
  const bucket = event.Records[0].s3.bucket.name;
  const key = decodeURIComponent(event.Records[0].s3.object.key.replace(/\+/g, " "));

  logger.info('Processing document', { key, bucket });
  tracer.putAnnotation('operation', 'processDocumentOCR');

  // Extract metadata from S3 key
  // Format: uploads/EMP-0000011/NATIONAL_ID/doc_1774086521598_sarah_id.pdf
  const keyParts = key.split('/');
  const employeeId = keyParts[1];
  const documentType = keyParts[2];
  const fileName = keyParts[3];
  const documentId = fileName.split('_')[1]; // Extract doc_1774086521598

  try {
    logger.info('Document metadata', { employeeId, documentType, documentId });
    tracer.putAnnotation('employeeId', employeeId);
    tracer.putAnnotation('documentType', documentType);

    // 0. A repeat of an S3 event for a document already read stops here: no file read, no AI, no events.
    //    One conditional write, so the role needs no extra table permission. It fails when the document
    //    was already read (ocr_completed_at is set) or has no row.
    try {
      await dynamodb.send(new UpdateItemCommand({
        TableName: "documents",
        Key: { employee_id: { S: employeeId }, document_id: { S: `doc_${documentId}` } },
        UpdateExpression: "SET ocr_started_at = :now",
        ConditionExpression: "attribute_exists(document_id) AND attribute_not_exists(ocr_completed_at)",
        ExpressionAttributeValues: { ":now": { S: new Date().toISOString() } },
      }));
    } catch (repeatErr) {
      if (repeatErr.name === 'ConditionalCheckFailedException') {
        logger.info('Document already read or unknown: event ignored', { documentId });
        return { statusCode: 200, body: { documentId: `doc_${documentId}`, employeeId, repeat: true } };
      }
      throw repeatErr;
    }

    // 1b. Publish document.uploaded event (NH-14)
    await publishEvent('document.uploaded', { employee_id: employeeId, document_id: documentId, document_type: documentType });

    // AI cost guardrail: documents of test employees (robots) never reach
    // Textract or Claude; they go straight to waiting for HR. If the employee
    // can't be read, play safe and treat it as test data.
    let robot = true;
    let record = {};
    try {
      const emp = await dynamodb.send(new GetItemCommand({
        TableName: EMPLOYEES_TABLE(),
        Key: { employee_id: { S: employeeId } },
        ProjectionExpression: 'email, last_name, id_number_last4',
      }));
      robot = !emp.Item || isRobotEmail(emp.Item.email?.S);
      record = { last_name: emp.Item?.last_name?.S, id_number_last4: emp.Item?.id_number_last4?.S };
    } catch (guardErr) {
      logger.warn('Employee lookup for AI guard failed; skipping AI', { error: guardErr.message });
    }
    markRobot(robot);
    const skipped = robot || aiSwitchedOff();
    let validationResult;
    if (skipped) {
      logger.info('AI skipped: document goes to HR without OCR', { documentType, robot });
      validationResult = { checks: {}, confidence: 0,
                           reasoning: robot ? AI_SKIPPED_LABEL : AI_OFF_LABEL };
    } else {
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

    // 4. Send to Claude to read the fields — prompt varies by document type
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
    validationResult = JSON.parse(claudeText);
    }

    // ONB-07: Batsi's check is worked out here from the record, never by the model.
    const check = checkFromRead({ ...validationResult, documentType, skipped }, record);

    // NOTE: full validation result not logged to avoid PII (may contain idNumber, name, accountHolder, etc.)
    logger.info('Validation complete', { confidence: validationResult.confidence, check });

    // 6. Save to document-verification table — fields vary by document type
    const verificationId = `ver_${Date.now()}`;
    const ocrCompletedAt = new Date().toISOString();

    const verificationItem = await buildVerificationItem({
      verificationId, employeeId, documentId, documentType, key, validationResult, check, ocrCompletedAt,
    });

    await dynamodb.send(
      new PutItemCommand({
        TableName: "document-verification",
        Item: verificationItem,
      })
    );

    logger.info('Saved verification record', { verificationId });

    // 7. Update documents table: every read document waits for HR (ONB-07).
    //    Only HR's Accept writes PASSED and only HR's Ask for a new one writes FAILED.
    const ocrStatus = "MANUAL_REVIEW";

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

    // 7b. Publish ocr.completed (NH-14), then tell HR once
    await publishEvent('ocr.completed', {
      employee_id: employeeId,
      document_id: documentId,
      document_type: documentType,
      confidence: validationResult.confidence,
      check,
    });
    await tellHrOnce({ employeeId, documentId, documentType, check });

    // 7c. NH-80: Bump employee stage INVITED/ACTIVE → DOCUMENTS_SUBMITTED on first doc processed.
    //     Conditional update — only advances, never regresses.
    try {
      await dynamodb.send(new UpdateItemCommand({
        TableName: EMPLOYEES_TABLE(),
        Key: { employee_id: { S: employeeId } },
        UpdateExpression: 'SET stage = :ds, documents_started_at = if_not_exists(documents_started_at, :now)',
        ConditionExpression: 'stage IN (:invited, :active)',
        ExpressionAttributeValues: {
          ':ds':      { S: 'DOCUMENTS_SUBMITTED' },
          ':invited': { S: 'INVITED' },
          ':active':  { S: 'ACTIVE' },
          ':now':     { S: new Date().toISOString() },
        },
      }));
      logger.info('Stage bumped to DOCUMENTS_SUBMITTED', { employeeId });
    } catch (stageErr) {
      // ConditionalCheckFailedException = already past INVITED/ACTIVE — fine.
      if (stageErr.name !== 'ConditionalCheckFailedException') {
        logger.warn('Failed to bump stage to DOCUMENTS_SUBMITTED', { error: stageErr.message, employeeId });
      }
    }

    // 7d. NH-42: Signal Step Functions that OCR + verification is complete.
    // createEmployee stored a task token on the employee record when it started
    // the StateMachine. We read it here and send SendTaskSuccess so the
    // WaitForDocumentUpload state can resume and proceed to AssessRisk.
    try {
      const empRecord = await dynamodb.send(new GetItemCommand({
        TableName: EMPLOYEES_TABLE(),
        Key: { employee_id: { S: employeeId } },
        ProjectionExpression: 'sfn_task_token',
      }));
      const taskToken = empRecord.Item?.sfn_task_token?.S;
      if (taskToken) {
        await sfn.send(new SendTaskSuccessCommand({
          taskToken,
          output: JSON.stringify({
            employeeId,
            verificationId,
            ocrStatus,
            confidence: validationResult.confidence,
            check,
          }),
        }));
        logger.info('Step Functions signaled — OCR complete', { employeeId, ocrStatus });
      } else {
        logger.info('No SFN task token on employee record — orchestration not active', { employeeId });
      }
    } catch (sfnErr) {
      // Non-fatal: OCR result is already written to DynamoDB and events published.
      // Log the error but return success so the S3 trigger does not retry.
      logger.warn('Failed to signal Step Functions', { error: sfnErr.message, employeeId });
    }

    // 8. Return the result
    return {
      statusCode: 200,
      body: {
        verificationId,
        documentId: `doc_${documentId}`,
        employeeId,
        ocrStatus,
        confidence: validationResult.confidence,
        check,
      },
    };
  } catch (error) {
    logger.error('Error processing document', { error });

    // ONB-07: a file that could not be read waits for HR as Needs a look. A machine never refuses a
    // document. Stamping ocr_completed_at also stops S3's retries from reading the file again.
    try {
      await dynamodb.send(
        new UpdateItemCommand({
          TableName: "documents",
          Key: {
            employee_id: { S: employeeId },
            document_id: { S: `doc_${documentId}` }
          },
          UpdateExpression: "SET ocr_status = :status, ocr_completed_at = :completedAt",
          ExpressionAttributeValues: {
            ":status": { S: "MANUAL_REVIEW" },
            ":completedAt": { S: new Date().toISOString() }
          }
        })
      );
      logger.warn('Document could not be read: waits for HR', { documentId });
      await tellHrOnce({ employeeId, documentId, documentType, check: 'NEEDS_A_LOOK' });
      return { statusCode: 200, body: { documentId: `doc_${documentId}`, employeeId, ocrStatus: 'MANUAL_REVIEW', check: 'NEEDS_A_LOOK' } };
    } catch (updateError) {
      logger.error('Failed to update document status', { error: updateError });
    }

    throw error;
  }
};

export const handler = handlerFn;
