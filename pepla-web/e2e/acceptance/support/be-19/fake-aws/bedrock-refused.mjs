// BE-19: copied from ../../be-18/fake-aws (BE-18 lock), unchanged.
// BE-18: copied from ../../be-17.1/fake-aws (BE-17.1 lock), unchanged.
// BE-17.1: copied unchanged from ../../be-17/fake-aws (BE-17 lock).
// BE-17: Bedrock. Importing and building the client is allowed (the AI Lambdas do it when they start);
// every send() is recorded and fails. The AI guard refuses a robot (and the off switch) before send(),
// so a correct run records no Bedrock call, and a test that finds one fails.
import { calls } from './world.mjs';
class Command { constructor(input) { this.input = input; } }
export class InvokeModelCommand extends Command { get op() { return 'InvokeModel'; } }
export class InvokeModelWithResponseStreamCommand extends Command { get op() { return 'InvokeModelWithResponseStream'; } }
export class ConverseCommand extends Command { get op() { return 'Converse'; } }
export class ConverseStreamCommand extends Command { get op() { return 'ConverseStream'; } }
export class BedrockRuntimeClient {
  constructor(config = {}) { this.config = config; }
  async send(cmd) {
    calls.push({ service: 'bedrock', op: cmd?.op ?? 'unknown' });
    throw new Error('BE-17 harness: a model was called. Nothing automated may call paid AI.');
  }
  destroy() {}
}
