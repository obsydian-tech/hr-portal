// REC-06.2: copied from ../../onb-18/fake-aws (ONB-18 lock) and added to. Step Functions that records every call WITH its input and the options
// it was sent with (`abortSignal` true when the caller passed one), and answers StartExecution the way world.sfn says:
//   world.sfn = { mode: 'ok' | 'exists' | 'denied' | 'throttle' | 'hang' }   (no world.sfn is 'ok')
//   ok        -> { executionArn, startDate }, as Step Functions answers a start, and a repeat of the same name and input while the run waits
//   exists    -> ExecutionAlreadyExists (400): the run is closed, or the input differs
//   denied    -> AccessDeniedException (400), as a role without states:StartExecution gets
//   throttle  -> ThrottlingException (400)
//   hang      -> never answers; it ends only when the caller's abort signal fires (then it throws an AbortError, as the SDK does)
// The error objects carry what the SDK's errors carry: a name, a message, $fault and $metadata.httpStatusCode.
import { calls, world } from './world.mjs';
class Command { constructor(input) { this.input = input; } }
export class SendTaskSuccessCommand extends Command { get op() { return 'SendTaskSuccess'; } }
export class SendTaskFailureCommand extends Command { get op() { return 'SendTaskFailure'; } }
export class SendTaskHeartbeatCommand extends Command { get op() { return 'SendTaskHeartbeat'; } }
export class StartExecutionCommand extends Command { get op() { return 'StartExecution'; } }
const fail = (name, message, status = 400) => {
  const e = new Error(message);
  e.name = name;
  e.$fault = 'client';
  e.$metadata = { httpStatusCode: status };
  return e;
};
export class SFNClient {
  constructor(config) { this.config = config; }
  async send(cmd, options) {
    if (cmd.op !== 'StartExecution') {
      calls.push({ service: 'sfn', op: cmd.op });
      return {};
    }
    calls.push({ service: 'sfn', op: 'StartExecution', input: JSON.parse(JSON.stringify(cmd.input ?? null)), abortSignal: !!options?.abortSignal });
    const mode = world.sfn?.mode ?? 'ok';
    if (mode === 'exists') throw fail('ExecutionAlreadyExists', 'Execution Already Exists: ' + String(cmd.input?.name));
    if (mode === 'denied') throw fail('AccessDeniedException', 'not authorized to perform: states:StartExecution');
    if (mode === 'throttle') throw fail('ThrottlingException', 'Rate exceeded');
    if (mode === 'hang') {
      return new Promise((_resolve, reject) => {
        const signal = options?.abortSignal;
        if (!signal) return;
        const abort = () => { const e = new Error('The operation was aborted'); e.name = 'AbortError'; reject(e); };
        if (signal.aborted) abort();
        else signal.addEventListener('abort', abort, { once: true });
      });
    }
    return { executionArn: `${cmd.input?.stateMachineArn ?? 'arn'}:${cmd.input?.name ?? 'run'}`, startDate: new Date(0) };
  }
}
