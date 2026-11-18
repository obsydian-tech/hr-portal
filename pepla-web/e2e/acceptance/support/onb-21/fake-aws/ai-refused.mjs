const m = new URL(import.meta.url).searchParams.get('m');
throw new Error(`ONB-21 harness: the reminder Lambda imported ${m}. Nothing automated may call paid AI.`);
