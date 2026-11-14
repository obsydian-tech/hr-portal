const m = new URL(import.meta.url).searchParams.get('m');
throw new Error(`ONB-15 harness: this Lambda imported ${m}. The three document routes call no AI, and nothing automated may call paid AI.`);
