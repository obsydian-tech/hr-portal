// Bedrock whose model answers world.model (an object, sent back as JSON text). InvokeModel answers in the
// Anthropic messages shape; Converse in the Converse shape.
import { world } from './world.mjs';
import { FakeAiClient } from './ai-fake.mjs';
class Command { constructor(input) { this.input = input; } }
export class InvokeModelCommand extends Command {}
export class ConverseCommand extends Command {}
export class BedrockRuntimeClient extends FakeAiClient {
  constructor() {
    super('bedrock', async (cmd) => {
      const text = typeof world.model === 'string' ? world.model : JSON.stringify(world.model ?? {});
      if (cmd instanceof ConverseCommand) {
        return { output: { message: { role: 'assistant', content: [{ text }] } }, stopReason: 'end_turn', usage: {} };
      }
      const body = { id: 'msg_onb07', type: 'message', role: 'assistant', content: [{ type: 'text', text }], stop_reason: 'end_turn' };
      return { body: new TextEncoder().encode(JSON.stringify(body)), contentType: 'application/json' };
    });
  }
}
