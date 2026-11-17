// TEN-02: Textract, as bedrock-refused.mjs does Bedrock. processDocumentOCR builds the client when it starts;
// every send() is recorded and fails. With AI calls switched off (or a robot), a correct run records none.
import { calls } from './world.mjs';
class Command { constructor(input) { this.input = input; } }
export class AnalyzeDocumentCommand extends Command { get op() { return 'AnalyzeDocument'; } }
export class DetectDocumentTextCommand extends Command { get op() { return 'DetectDocumentText'; } }
export class AnalyzeIDCommand extends Command { get op() { return 'AnalyzeID'; } }
export class TextractClient {
  constructor(config = {}) { this.config = config; }
  async send(cmd) {
    calls.push({ service: 'textract', op: cmd?.op ?? 'unknown' });
    throw new Error('TEN-02 harness: Textract was called. Nothing automated may call paid AI.');
  }
  destroy() {}
}
