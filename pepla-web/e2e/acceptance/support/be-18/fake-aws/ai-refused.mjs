// BE-18: copied from ../../be-17.1/fake-aws (BE-17.1 lock), unchanged.
// BE-17.1: copied unchanged from ../../be-17/fake-aws (BE-17 lock).
const m = new URL(import.meta.url).searchParams.get('m');
throw new Error(`BE-17 harness: this Lambda imported ${m}. Nothing automated may call paid AI.`);
