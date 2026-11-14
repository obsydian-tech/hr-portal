// Step Functions that records task-token callbacks.
import { calls } from './world.mjs';
class Command { constructor(input) { this.input = input; } }
export class SendTaskSuccessCommand extends Command { get op() { return 'SendTaskSuccess'; } }
export class SendTaskFailureCommand extends Command { get op() { return 'SendTaskFailure'; } }
export class SendTaskHeartbeatCommand extends Command { get op() { return 'SendTaskHeartbeat'; } }
export class StartExecutionCommand extends Command { get op() { return 'StartExecution'; } }
export class SFNClient {
  async send(cmd) { calls.push({ service: 'sfn', op: cmd.op }); return {}; }
}
