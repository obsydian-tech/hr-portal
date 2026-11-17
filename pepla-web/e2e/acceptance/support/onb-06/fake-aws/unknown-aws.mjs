const m = new URL(import.meta.url).searchParams.get('m');
throw new Error(`ONB-05 harness: ${m} has no fake. getMyStart and recordConsent need only DynamoDB (and Powertools).`);
