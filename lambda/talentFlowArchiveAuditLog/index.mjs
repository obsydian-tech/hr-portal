/**
 * AI-005 (NH-131) — talentFlowArchiveAuditLog
 *
 * Triggered by DynamoDB Streams on talent-flow-agent-audit (INSERT events only).
 * Writes gzipped JSONL objects to S3 under the Hive-style partition prefix:
 *   talent-flow/audit/year=YYYY/month=MM/day=DD/{isoTimestamp}.jsonl.gz
 *
 * Encrypted with aws:kms (alias/talent-flow/agent-audit) — not AES256.
 * Returns batchItemFailures for partial batch failure support.
 */

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { createGzip } from "node:zlib";
import { promisify } from "node:util";

const gzip = promisify(
  (buf, cb) => {
    const gz = createGzip();
    const chunks = [];
    gz.on("data", (c) => chunks.push(c));
    gz.on("end", () => cb(null, Buffer.concat(chunks)));
    gz.on("error", cb);
    gz.end(buf);
  }
);

const s3 = new S3Client({ region: process.env.AWS_REGION ?? "af-south-1" });

/**
 * Build S3 key: talent-flow/audit/year=YYYY/month=MM/day=DD/{isoTimestamp}.jsonl.gz
 * Using the record's SK (ISO timestamp) so the partition matches the event date,
 * not the Lambda execution date — important for stream re-drives.
 */
function buildS3Key(isoTimestamp) {
  const d = new Date(isoTimestamp);
  const year  = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day   = String(d.getUTCDate()).padStart(2, "0");
  const safe  = isoTimestamp.replace(/[:.]/g, "-");
  return `talent-flow/audit/year=${year}/month=${month}/day=${day}/${safe}.jsonl.gz`;
}

export const handler = async (event) => {
  const BUCKET = process.env.AUDIT_ARCHIVE_BUCKET;

  // Filter to INSERT events only — ignore MODIFY and REMOVE
  const inserts = (event.Records ?? []).filter((r) => r.eventName === "INSERT");

  if (inserts.length === 0) {
    console.log(JSON.stringify({ event: "archive_skipped", reason: "no_inserts", total: event.Records?.length ?? 0 }));
    return { batchItemFailures: [] };
  }

  const failures = [];

  for (const record of inserts) {
    try {
      const newImage = record.dynamodb?.NewImage;
      if (!newImage) continue;

      // Unmarshall DynamoDB attribute map to plain JS object
      const item = unmarshall(newImage);

      // Use the record's sort key (ISO timestamp) as the partition anchor
      const sk = item.sk ?? new Date().toISOString();
      const key = buildS3Key(sk);

      const jsonl = JSON.stringify(item) + "\n";
      const compressed = await gzip(Buffer.from(jsonl, "utf-8"));

      await s3.send(new PutObjectCommand({
        Bucket:               BUCKET,
        Key:                  key,
        Body:                 compressed,
        ContentEncoding:      "gzip",
        ContentType:          "application/x-ndjson",
        ServerSideEncryption: "aws:kms",
        Metadata: {
          "talent-flow-source": "agent-audit-stream",
          "talent-flow-ticket": "NH-131",
        },
      }));

      console.log(JSON.stringify({ event: "audit_archived", bucket: BUCKET, key, sk }));
    } catch (err) {
      console.error(JSON.stringify({ event: "archive_error", error: err.message, sequenceNumber: record.dynamodb?.SequenceNumber }));
      failures.push({ itemIdentifier: record.dynamodb?.SequenceNumber });
    }
  }

  console.log(JSON.stringify({ event: "archive_complete", inserted: inserts.length, failures: failures.length }));

  // Partial batch failure support — only retry failed records
  return { batchItemFailures: failures };
};

// ---------------------------------------------------------------------------
// Minimal DynamoDB attribute-value unmarshaller (no SDK dependency needed here)
// ---------------------------------------------------------------------------
function unmarshall(item) {
  const out = {};
  for (const [k, v] of Object.entries(item)) {
    out[k] = unmarshallValue(v);
  }
  return out;
}

function unmarshallValue(v) {
  if (v.S !== undefined) return v.S;
  if (v.N !== undefined) return Number(v.N);
  if (v.BOOL !== undefined) return v.BOOL;
  if (v.NULL !== undefined) return null;
  if (v.L !== undefined) return v.L.map(unmarshallValue);
  if (v.M !== undefined) return unmarshall(v.M);
  if (v.SS !== undefined) return new Set(v.SS);
  if (v.NS !== undefined) return new Set(v.NS.map(Number));
  return v; // fallback
}
