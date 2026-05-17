/**
 * AI-005 (NH-131) — talentFlowArchiveAuditLog unit tests
 * ESM Jest pattern: jest.unstable_mockModule + import() inside tests
 */

import { jest, describe, test, expect, beforeEach } from "@jest/globals";

// ---------------------------------------------------------------------------
// Mock @aws-sdk/client-s3 BEFORE dynamic import of the handler
// ---------------------------------------------------------------------------
const mockS3Send = jest.fn();

jest.unstable_mockModule("@aws-sdk/client-s3", () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: mockS3Send })),
  PutObjectCommand: jest.fn().mockImplementation((params) => ({ ...params, _type: "PutObjectCommand" })),
}));

// ---------------------------------------------------------------------------
// Helper: build a minimal DynamoDB Stream record
// ---------------------------------------------------------------------------
function makeRecord({ eventName = "INSERT", sk = "2026-05-17T10:00:00.000Z", extra = {}, sequenceNumber = "000001" } = {}) {
  return {
    eventName,
    dynamodb: {
      SequenceNumber: sequenceNumber,
      NewImage: eventName === "INSERT"
        ? {
            pk: { S: "SESSION#abc" },
            sk: { S: sk },
            action: { S: "getEmployee" },
            userId: { S: "user-001" },
            ...extra,
          }
        : undefined,
    },
  };
}

// ---------------------------------------------------------------------------
// Import handler lazily (after mocks are registered)
// ---------------------------------------------------------------------------
let handler;
beforeEach(async () => {
  mockS3Send.mockReset();
  process.env.AUDIT_ARCHIVE_BUCKET = "talent-flow-audit-archive-937137806477";
  process.env.AWS_REGION = "af-south-1";

  if (!handler) {
    const mod = await import("./index.mjs");
    handler = mod.handler;
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("talentFlowArchiveAuditLog", () => {
  test("1. INSERT record → PutObject with correct Hive key, aws:kms SSE, gzipped body", async () => {
    mockS3Send.mockResolvedValueOnce({});

    const sk = "2026-05-17T10:30:00.000Z";
    const result = await handler({ Records: [makeRecord({ sk })] });

    expect(result).toEqual({ batchItemFailures: [] });
    expect(mockS3Send).toHaveBeenCalledTimes(1);

    const command = mockS3Send.mock.calls[0][0];
    expect(command.Key).toMatch(/^talent-flow\/audit\/year=2026\/month=05\/day=17\//);
    expect(command.Key).toMatch(/\.jsonl\.gz$/);
    expect(command.ServerSideEncryption).toBe("aws:kms");
    expect(command.ContentEncoding).toBe("gzip");
    expect(command.Bucket).toBe("talent-flow-audit-archive-937137806477");
    expect(Buffer.isBuffer(command.Body)).toBe(true);
  });

  test("2. MODIFY record → no PutObject call, returns empty batchItemFailures", async () => {
    const result = await handler({ Records: [makeRecord({ eventName: "MODIFY" })] });

    expect(result).toEqual({ batchItemFailures: [] });
    expect(mockS3Send).not.toHaveBeenCalled();
  });

  test("3. REMOVE record → no PutObject call, returns empty batchItemFailures", async () => {
    const result = await handler({ Records: [makeRecord({ eventName: "REMOVE" })] });

    expect(result).toEqual({ batchItemFailures: [] });
    expect(mockS3Send).not.toHaveBeenCalled();
  });

  test("4. Mixed batch (1 INSERT + 1 MODIFY) → exactly 1 PutObject", async () => {
    mockS3Send.mockResolvedValueOnce({});

    const records = [
      makeRecord({ eventName: "INSERT", sk: "2026-05-17T11:00:00.000Z", sequenceNumber: "000002" }),
      makeRecord({ eventName: "MODIFY", sequenceNumber: "000003" }),
    ];

    const result = await handler({ Records: records });

    expect(result).toEqual({ batchItemFailures: [] });
    expect(mockS3Send).toHaveBeenCalledTimes(1);
  });

  test("5. S3 PutObject failure → returns batchItemFailures with correct sequenceNumber", async () => {
    mockS3Send.mockRejectedValueOnce(new Error("S3 access denied"));

    const seq = "999999";
    const result = await handler({ Records: [makeRecord({ sequenceNumber: seq })] });

    expect(result.batchItemFailures).toHaveLength(1);
    expect(result.batchItemFailures[0]).toEqual({ itemIdentifier: seq });
  });
});
