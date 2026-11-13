const m = new URL(import.meta.url).searchParams.get('m');
throw new Error(`ONB-12 harness: ${m} has no fake. The fake AWS covers client-dynamodb, lib-dynamodb, util-dynamodb, client-kms and Powertools.`);
