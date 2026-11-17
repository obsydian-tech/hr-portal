const m = new URL(import.meta.url).searchParams.get('m');
throw new Error(`BE-17 harness: this Lambda imported ${m}. Nothing automated may call paid AI.`);
