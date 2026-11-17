// BE-20: copied from ../../be-18/fake-aws (BE-18 lock), unchanged.
// BE-18: copied from ../../be-17.1/fake-aws (BE-17.1 lock), unchanged.
// BE-17.1: copied unchanged from ../../be-17/fake-aws (BE-17 lock).
import { register } from 'node:module';
register('./hooks.mjs', import.meta.url);
