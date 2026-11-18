// Textract that "reads" world.textract: { lines: [...] } gives LINE blocks; { error: "Name" } throws
// that error, as Textract does for a file it cannot read.
import { world, awsError } from './world.mjs';
import { FakeAiClient } from './ai-fake.mjs';
class Command { constructor(input) { this.input = input; } }
export class AnalyzeDocumentCommand extends Command {}
export class DetectDocumentTextCommand extends Command {}
export class AnalyzeIDCommand extends Command {}
export class TextractClient extends FakeAiClient {
  constructor() {
    super('textract', async () => {
      const t = world.textract ?? { lines: [] };
      if (t.error) throw awsError(t.error, 'Request has unsupported document format');
      const Blocks = (t.lines ?? []).map((Text, i) => ({ BlockType: 'LINE', Id: `line-${i}`, Text, Confidence: 99 }));
      return { Blocks: [{ BlockType: 'PAGE', Id: 'page-1' }, ...Blocks], DocumentMetadata: { Pages: 1 } };
    });
  }
}
