// The SDK's HTTP handler, as far as a Lambda uses it to give a client a request timeout: it keeps the options it was given,
// so the fake EventBridge can read them. (@aws-sdk/node-http-handler and @smithy/node-http-handler both land here.)
export class NodeHttpHandler {
  constructor(options = {}) { this.options = options; this.config = options; }
  destroy() {}
}
export const NodeHttp2Handler = NodeHttpHandler;
