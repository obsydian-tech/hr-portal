const m = new URL(import.meta.url).searchParams.get('m');
throw new Error(`ONB-07 harness: this Lambda imported ${m}. Only the guarded Textract and Bedrock clients have (recording) fakes; nothing automated may call paid AI.`);
