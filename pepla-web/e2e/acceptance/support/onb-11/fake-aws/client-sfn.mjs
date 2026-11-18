// Step Functions that records every task-token callback with its token and output (ONB-11).
// A token Step Functions could not accept is refused as AWS refuses it: world.spentTokens lists the tokens already
// used or timed out (TaskTimedOut), and a token that is not in world.liveTokens either (when that list is given)
// is InvalidToken. A token that is accepted is spent: run.mjs hands world.spentTokens back after the run.
import { calls, world, awsError } from './world.mjs';
class Command { constructor(input) { this.input = input; } }
export class SendTaskSuccessCommand extends Command { get op() { return 'SendTaskSuccess'; } }
export class SendTaskFailureCommand extends Command { get op() { return 'SendTaskFailure'; } }
export class SendTaskHeartbeatCommand extends Command { get op() { return 'SendTaskHeartbeat'; } }
export class StartExecutionCommand extends Command { get op() { return 'StartExecution'; } }
export class SFNClient {
  async send(cmd) {
    const token = cmd.input?.taskToken;
    let output;
    try { output = cmd.input?.output === undefined ? undefined : JSON.parse(cmd.input.output); } catch { output = cmd.input?.output; }
    calls.push({ service: 'sfn', op: cmd.op, token, output, input: cmd.input });
    if (cmd.op === 'SendTaskSuccess' || cmd.op === 'SendTaskFailure') {
      world.spentTokens ??= [];
      if (world.spentTokens.includes(token)) throw awsError('TaskTimedOut', 'The task token has already been used or has timed out.');
      if (Array.isArray(world.liveTokens) && !world.liveTokens.includes(token)) throw awsError('InvalidToken', 'The provided task token is not valid.');
      world.spentTokens.push(token);
    }
    return {};
  }
}
