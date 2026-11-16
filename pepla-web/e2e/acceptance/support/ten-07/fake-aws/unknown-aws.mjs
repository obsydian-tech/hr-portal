const m = new URL(import.meta.url).searchParams.get('m');
throw new Error(`TEN-07 harness: ${m} has no fake. The fake AWS covers AWS Config only.`);
