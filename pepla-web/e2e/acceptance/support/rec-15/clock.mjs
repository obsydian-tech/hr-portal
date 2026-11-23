// REC-15: a fixed clock for one Lambda run (a preload, NODE_OPTIONS --import). REC15_NOW is an ISO time: `new Date()` with no
// argument and `Date.now()` give that time for the whole run, so a test can say "74 percent of the stage's hours are used" exactly.
// Every other use of Date is the real one. Test support only; no application code.
const at = Date.parse(process.env.REC15_NOW ?? '');
if (Number.isFinite(at)) {
  const RealDate = Date;
  class FixedDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(at);
      else super(...args);
    }
    static now() {
      return at;
    }
  }
  globalThis.Date = FixedDate;
}
