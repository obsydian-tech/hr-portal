const m = new URL(import.meta.url).searchParams.get('m');
throw new Error(`ONB-21 harness: the reminder Lambda imported ${m}. Its role allows logs, X-Ray and DynamoDB only; Postmark is the one outside service.`);
