const m = new URL(import.meta.url).searchParams.get('m');
throw new Error(`TEN-07 harness: this Lambda imported ${m}. Nothing automated may call paid AI.`);
