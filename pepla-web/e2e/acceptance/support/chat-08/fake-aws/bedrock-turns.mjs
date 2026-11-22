// CHAT-08: CHAT-02's scripted model (../../chat-02/fake-aws/bedrock-scripted.mjs, which is locked) copied, with one thing added:
// a scripted answer may hold text AND several lookups in one message, as a real model message can:
//   { text?: string, tools: [{ name, input }] }   -> content [text?, tool_use, tool_use, ...], stop_reason tool_use
// The other answer forms are CHAT-02's, unchanged. Nothing here reaches a network or any AI service; a world with no script
// refuses every send. Every send is recorded as { service: 'bedrock', op: 'InvokeModel', kind, body }.
import { calls, world } from '../../chat-05/fake-aws/world.mjs';
class Command { constructor(input) { this.input = input; } }
export class InvokeModelCommand extends Command { get op() { return 'InvokeModel'; } }
export class InvokeModelWithResponseStreamCommand extends Command { get op() { return 'InvokeModelWithResponseStream'; } }
export class ConverseCommand extends Command { get op() { return 'Converse'; } }
export class ConverseStreamCommand extends Command { get op() { return 'ConverseStream'; } }
const enc = (o) => new TextEncoder().encode(JSON.stringify(o));
let n = 0;
export class BedrockRuntimeClient {
  constructor(config = {}) { this.config = config; }
  async send(cmd) {
    const script = world.bedrock;
    if (cmd?.op !== 'InvokeModel' || !script) {
      calls.push({ service: 'bedrock', op: cmd?.op ?? 'unknown', refused: true });
      throw new Error('CHAT-08 harness: a model was called with no answers given. Nothing automated may call paid AI.');
    }
    let body = {};
    try { body = JSON.parse(cmd.input.body); } catch { /* recorded as empty */ }
    const kind = body.tools ? 'answer' : body.max_tokens <= 10 ? 'intent' : 'summary';
    calls.push({ service: 'bedrock', op: 'InvokeModel', kind, modelId: cmd.input.modelId, body });
    const usage = { input_tokens: 11, output_tokens: 7 };
    n += 1;
    const $metadata = { requestId: `chat08-fake-request-${n}` };
    if (kind === 'intent' && script.intentError) { const e = new Error(script.intentError.message); e.name = script.intentError.name; throw e; }
    if (kind === 'summary' && script.summaryError) { const e = new Error(script.summaryError.message); e.name = script.summaryError.name; throw e; }
    if (kind === 'intent') return { body: enc({ content: [{ type: 'text', text: script.intent ?? 'TOOL_REQUIRED' }], usage }), $metadata };
    if (kind === 'summary') return { body: enc({ content: [{ type: 'text', text: script.summary ?? 'Summary of the earlier questions.' }], usage }), $metadata };
    const next = (script.answers ?? []).shift();
    if (!next) throw new Error('CHAT-08 harness: the script has no more answers');
    if (next.error) { const e = new Error(next.error.message ?? next.error.name); e.name = next.error.name ?? 'ModelError'; throw e; }
    if (Array.isArray(next.tools)) {
      const content = [...(next.text ? [{ type: 'text', text: next.text }] : []), ...next.tools.map((t, i) => ({ type: 'tool_use', id: `toolu_chat08_${n}_${i}`, name: t.name, input: t.input ?? {} }))];
      return { body: enc({ content, stop_reason: 'tool_use', usage }), $metadata };
    }
    if (next.tool) return { body: enc({ content: [{ type: 'tool_use', id: `toolu_chat02_${n}`, name: next.tool.name, input: next.tool.input ?? {} }], stop_reason: 'tool_use', usage }), $metadata };
    return { body: enc({ content: [{ type: 'text', text: next.text }], stop_reason: 'end_turn', usage }), $metadata };
  }
  destroy() {}
}
