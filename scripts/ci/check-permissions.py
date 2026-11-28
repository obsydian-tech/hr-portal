#!/usr/bin/env python3
"""Does each function's role allow what its code does? (pipeline step 7)

Standard library only. Reads text: no AWS call, no AWS sign-in, no network.

For every function under lambda/ (and every Step Functions workflow) it lists the
AWS calls in the code, looks up the role in the Terraform files (infra/ and
talent-flow-infra/), and says for each call: allowed, missing, key missing, or
"could not judge". A call on a table, bucket, queue or secret that is locked
with an encryption key also needs the role to be allowed to use that key.

  check-permissions.py [--root DIR] [--mode report|enforce] [--base-ref REF]
                       [--exceptions FILE] [--summary FILE]

Report mode (the default) always exits 0. Enforce mode (pull requests only,
that is, when --base-ref is given) exits 1 on a finding the pull request brings
in, and 2 when the check itself cannot run. Findings that are already on the
base branch are printed but never block.

Spec: process/pipeline-specs/STEP-7-permission-check-spec.md. Tests:
scripts/ci/test_check_permissions.py and scripts/ci/permission-fixtures/.
"""
import argparse
import fnmatch
import io
import json
import os
import re
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

MODE_DEFAULT = "report"
BLOCKING = ("missing", "key missing")


# ----------------------------------------------------------------------------
# Values that could not be worked out
# ----------------------------------------------------------------------------
class Unknown:
    def __init__(self, why="not readable"):
        self.why = why

    def __repr__(self):
        return "Unknown(%s)" % self.why


def unk(v):
    return isinstance(v, Unknown)


class HclError(Exception):
    pass


# ----------------------------------------------------------------------------
# Files: the real repo, or a fixture folder whose files carry a .txt suffix
# ----------------------------------------------------------------------------
class Tree:
    def __init__(self, root):
        self.root = Path(root)
        self.fixture = (self.root / "SOURCES.txt").is_file()

    def _real(self, rel):
        p = self.root / rel
        if self.fixture and not p.exists():
            p = self.root / (rel + ".txt")
        return p

    def exists(self, rel):
        return self._real(rel).is_file()

    def read(self, rel):
        return self._real(rel).read_text(encoding="utf-8", errors="replace")

    def files(self, prefix):
        base = self.root / prefix
        out = []
        if not base.is_dir():
            return out
        for dp, dn, fn in os.walk(base):
            dn[:] = sorted(d for d in dn if d not in ("node_modules", ".terraform", ".git"))
            for f in sorted(fn):
                rel = str((Path(dp) / f).relative_to(self.root)).replace(os.sep, "/")
                if self.fixture:
                    if rel.endswith("SOURCES.txt"):
                        continue
                    if rel.endswith(".txt"):
                        rel = rel[:-4]
                out.append(rel)
        return out

    def dirs(self, prefix):
        base = self.root / prefix
        if not base.is_dir():
            return []
        return sorted(d.name for d in base.iterdir() if d.is_dir() and d.name != "node_modules")


# ----------------------------------------------------------------------------
# A small reader for Terraform text
# ----------------------------------------------------------------------------
IDENT_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]*(?:-[A-Za-z0-9_]+)*")
NUM_RE = re.compile(r"\d+(?:\.\d+)?")


class Parser:
    def __init__(self, text, fname="", depth=0):
        self.s = text
        self.i = 0
        self.n = len(text)
        self.fname = fname
        self.depth = depth

    def line(self):
        return self.s.count("\n", 0, self.i) + 1

    def err(self, msg):
        raise HclError("%s:%d: %s" % (self.fname, self.line(), msg))

    def ws(self, nl=None):
        nl = self.depth > 0 if nl is None else nl
        while self.i < self.n:
            c = self.s[self.i]
            if c in " \t\r":
                self.i += 1
            elif c == "\n":
                if nl:
                    self.i += 1
                else:
                    break
            elif c == "#" or self.s.startswith("//", self.i):
                while self.i < self.n and self.s[self.i] != "\n":
                    self.i += 1
            elif self.s.startswith("/*", self.i):
                j = self.s.find("*/", self.i + 2)
                self.i = self.n if j < 0 else j + 2
            else:
                break

    def peek(self, tok):
        return self.s.startswith(tok, self.i)

    def eat(self, tok):
        if self.s.startswith(tok, self.i):
            self.i += len(tok)
            return True
        return False

    def expect(self, tok):
        self.ws()
        if not self.eat(tok):
            self.err("expected %r near %r" % (tok, self.s[self.i:self.i + 30]))

    # ---- body: attributes and blocks
    def body(self, close):
        items = []
        while True:
            self.ws(True)
            if self.i >= self.n:
                if close:
                    self.err("unexpected end of file")
                return items
            c = self.s[self.i]
            if c == "}":
                if not close:
                    self.err("unexpected }")
                self.i += 1
                return items
            line = self.line()
            m = IDENT_RE.match(self.s, self.i)
            if not m:
                self.err("unexpected %r" % self.s[self.i:self.i + 20])
            name = m.group(0)
            self.i = m.end()
            self.ws(False)
            if self.peek("=") and not self.peek("=="):
                self.i += 1
                self.ws(False)
                items.append(("attr", name, self.expr(), line))
                continue
            labels = []
            while True:
                self.ws(False)
                if self.peek('"'):
                    e = self.string()
                    labels.append(e[1] if e[0] == "str" else "?")
                    continue
                m2 = IDENT_RE.match(self.s, self.i)
                if m2:
                    labels.append(m2.group(0))
                    self.i = m2.end()
                    continue
                break
            if not self.eat("{"):
                self.err("expected { after block %s" % name)
            items.append(("block", name, labels, self.body(True), line))

    # ---- expressions
    LEVELS = [("||",), ("&&",), ("==", "!="), ("<=", ">=", "<", ">"), ("+", "-"), ("*", "/", "%")]

    def expr(self):
        c = self.binop(0)
        self.ws()
        if self.peek("?"):
            self.i += 1
            self.depth += 1
            a = self.expr()
            self.expect(":")
            b = self.expr()
            self.depth -= 1
            return ("cond", c, a, b)
        return c

    def binop(self, lvl):
        if lvl >= len(self.LEVELS):
            return self.unary()
        left = self.binop(lvl + 1)
        while True:
            self.ws()
            hit = None
            for op in self.LEVELS[lvl]:
                if self.peek(op):
                    if op in "<>" and (self.peek("<<") or self.peek("=>")):
                        continue
                    hit = op
                    break
            if hit is None or self.peek("=>"):
                return left
            self.i += len(hit)
            right = self.binop(lvl + 1)
            left = ("bin", hit, left, right)

    def unary(self):
        self.ws()
        if self.peek("!") and not self.peek("!="):
            self.i += 1
            return ("not", self.unary())
        if self.peek("-"):
            self.i += 1
            return ("neg", self.unary())
        return self.postfix(self.primary())

    def postfix(self, e):
        while True:
            j = self.i
            self.ws()
            if self.peek(".") and not self.peek("..."):
                k = self.i + 1
                if k < self.n and self.s[k] == "*":
                    self.i = k + 1
                    e = ("splat", e)
                    continue
                m = IDENT_RE.match(self.s, k) or NUM_RE.match(self.s, k)
                if m:
                    self.i = m.end()
                    e = ("attr", e, m.group(0))
                    continue
            elif self.peek("["):
                self.i += 1
                self.depth += 1
                self.ws()
                if self.peek("*"):
                    self.i += 1
                    self.expect("]")
                    self.depth -= 1
                    e = ("splat", e)
                    continue
                idx = self.expr()
                self.expect("]")
                self.depth -= 1
                e = ("index", e, idx)
                continue
            self.i = j
            return e

    def primary(self):
        self.ws()
        if self.i >= self.n:
            self.err("unexpected end of expression")
        c = self.s[self.i]
        if c == '"':
            return self.string()
        if self.peek("<<"):
            return self.heredoc()
        if c.isdigit():
            m = NUM_RE.match(self.s, self.i)
            self.i = m.end()
            t = m.group(0)
            return ("lit", float(t) if "." in t else int(t))
        if c == "(":
            self.i += 1
            self.depth += 1
            e = self.expr()
            self.expect(")")
            self.depth -= 1
            return e
        if c == "[":
            return self.list_()
        if c == "{":
            return self.object_()
        m = IDENT_RE.match(self.s, self.i)
        if not m:
            self.err("unexpected %r" % self.s[self.i:self.i + 20])
        name = m.group(0)
        self.i = m.end()
        if name == "true":
            return ("lit", True)
        if name == "false":
            return ("lit", False)
        if name == "null":
            return ("lit", None)
        if self.peek("("):
            self.i += 1
            self.depth += 1
            args = []
            while True:
                self.ws()
                if self.peek(")"):
                    self.i += 1
                    break
                if self.peek(","):
                    self.i += 1
                    continue
                if self.peek("..."):
                    self.i += 3
                    continue
                args.append(self.expr())
            self.depth -= 1
            return ("call", name, args)
        return ("id", name)

    def for_parts(self):
        self.ws()
        vars_ = []
        while True:
            self.ws()
            m = IDENT_RE.match(self.s, self.i)
            if not m:
                self.err("bad for expression")
            vars_.append(m.group(0))
            self.i = m.end()
            self.ws()
            if self.eat(","):
                continue
            break
        self.ws()
        if not self.eat("in"):
            self.err("expected in")
        coll = self.expr()
        self.expect(":")
        return vars_, coll

    def list_(self):
        self.i += 1
        self.depth += 1
        self.ws()
        m = IDENT_RE.match(self.s, self.i)
        if m and m.group(0) == "for":
            self.i += 3
            vars_, coll = self.for_parts()
            val = self.expr()
            cond = None
            self.ws()
            if self.s.startswith("if", self.i):
                self.i += 2
                cond = self.expr()
            self.expect("]")
            self.depth -= 1
            return ("for", vars_, coll, None, val, cond)
        items = []
        while True:
            self.ws()
            if self.peek("]"):
                self.i += 1
                break
            if self.peek(","):
                self.i += 1
                continue
            items.append(self.expr())
        self.depth -= 1
        return ("list", items)

    def object_(self):
        self.i += 1
        self.depth += 1
        self.ws()
        m = IDENT_RE.match(self.s, self.i)
        if m and m.group(0) == "for":
            self.i = m.end()
            vars_, coll = self.for_parts()
            k = self.expr()
            self.ws()
            v = None
            if self.eat("=>"):
                v = self.expr()
            self.ws()
            self.eat("...")
            cond = None
            self.ws()
            if self.s.startswith("if", self.i):
                self.i += 2
                cond = self.expr()
            self.expect("}")
            self.depth -= 1
            return ("for", vars_, coll, k, v, cond)
        entries = []
        while True:
            self.ws()
            if self.peek("}"):
                self.i += 1
                break
            if self.peek(","):
                self.i += 1
                continue
            if self.peek("("):
                self.i += 1
                key = self.expr()
                self.expect(")")
            elif self.peek('"'):
                key = self.string()
            else:
                m = IDENT_RE.match(self.s, self.i) or NUM_RE.match(self.s, self.i)
                if not m:
                    self.err("bad object key near %r" % self.s[self.i:self.i + 20])
                key = ("str", m.group(0))
                self.i = m.end()
            self.ws()
            if self.peek("=") or self.peek(":"):
                self.i += 1
            else:
                self.err("expected = in object")
            entries.append((key, self.expr()))
        self.depth -= 1
        return ("obj", entries)

    # ---- strings and templates
    def skip_string(self, i):
        # i at the opening quote; returns the index after the closing quote
        i += 1
        while i < self.n:
            c = self.s[i]
            if c == "\\":
                i += 2
                continue
            if c == '"':
                return i + 1
            if self.s.startswith("${", i) or self.s.startswith("%{", i):
                i = self.find_close(i + 2) + 1
                continue
            i += 1
        self.err("unterminated string")

    def find_close(self, i):
        depth = 1
        while i < self.n:
            c = self.s[i]
            if c == '"':
                i = self.skip_string(i)
                continue
            if c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    return i
            i += 1
        self.err("unterminated interpolation")

    def template(self, text, escapes):
        parts, buf, i, n = [], [], 0, len(text)
        while i < n:
            c = text[i]
            if escapes and c == "\\" and i + 1 < n:
                d = text[i + 1]
                if d == "u" and i + 5 < n + 1:
                    try:
                        buf.append(chr(int(text[i + 2:i + 6], 16)))
                        i += 6
                        continue
                    except ValueError:
                        pass
                buf.append({"n": "\n", "t": "\t", "r": "\r"}.get(d, d))
                i += 2
                continue
            if text.startswith("$${", i) or text.startswith("%%{", i):
                buf.append(text[i + 1:i + 3])
                i += 3
                continue
            if text.startswith("${", i):
                sub = Parser(text, self.fname, 1)
                j = sub.find_close(i + 2)
                if buf:
                    parts.append("".join(buf))
                    buf = []
                p = Parser(text[i + 2:j], self.fname, 1)
                parts.append(p.expr())
                i = j + 1
                continue
            if text.startswith("%{", i):
                sub = Parser(text, self.fname, 1)
                j = sub.find_close(i + 2)
                if buf:
                    parts.append("".join(buf))
                    buf = []
                parts.append(("unk", "template directive"))
                i = j + 1
                continue
            buf.append(c)
            i += 1
        if buf:
            parts.append("".join(buf))
        if not parts:
            return ("str", "")
        if all(isinstance(p, str) for p in parts):
            return ("str", "".join(parts))
        return ("tmpl", parts)

    def string(self):
        j = self.skip_string(self.i)
        inner = self.s[self.i + 1:j - 1]
        self.i = j
        return self.template(inner, True)

    def heredoc(self):
        m = re.compile(r"<<(-?)([A-Za-z_][A-Za-z0-9_]*)[ \t]*\r?\n").match(self.s, self.i)
        if not m:
            self.err("bad heredoc")
        marker = m.group(2)
        indent = m.group(1) == "-"
        start = m.end()
        lines, j = [], start
        while j <= self.n:
            k = self.s.find("\n", j)
            line = self.s[j:] if k < 0 else self.s[j:k]
            if (line.strip() if indent else line.rstrip("\r")) == marker:
                self.i = self.n if k < 0 else k
                break
            lines.append(line)
            if k < 0:
                self.err("unterminated heredoc")
            j = k + 1
        if indent and lines:
            width = min((len(x) - len(x.lstrip()) for x in lines if x.strip()), default=0)
            lines = [x[width:] for x in lines]
        return self.template("\n".join(lines) + "\n", False)


def parse_hcl(text, fname=""):
    return Parser(text, fname).body(False)


def attrs(body):
    return {it[1]: it[2] for it in body if it[0] == "attr"}


def attr_line(body, name):
    for it in body:
        if it[0] == "attr" and it[1] == name:
            return it[3]
    return 0


def blocks(body, typ):
    return [it for it in body if it[0] == "block" and it[1] == typ]


# ----------------------------------------------------------------------------
# Working out values (variables, locals, references, a few functions)
# ----------------------------------------------------------------------------
class DocRef:
    def __init__(self, ctx, block):
        self.ctx = ctx
        self.block = block


class Ctx:
    """One Terraform folder (or one child folder with its inputs bound)."""

    def __init__(self, name, tree, folder, files, env_override=None, bound=None, key_prefix=""):
        self.name = name
        self.tree = tree
        self.folder = folder
        self.files = files  # list of (rel path, items)
        self.env_override = env_override
        self.bound = bound  # dict name -> value for a child folder
        self.key_prefix = key_prefix
        self.resources = {}
        self.data = {}
        self.submods = {}
        self.locals = {}
        self.variables = {}
        self.outputs = {}
        self.tfvars = {}
        self._local_cache = {}
        self._busy = set()
        self.file_of = {}
        for rel, items in files:
            for it in items:
                if it[0] != "block":
                    continue
                t, labels, body = it[1], it[2], it[3]
                if t == "resource" and len(labels) == 2:
                    self.resources[(labels[0], labels[1])] = it
                    self.file_of[("resource",) + tuple(labels)] = rel
                elif t == "data" and len(labels) == 2:
                    self.data[(labels[0], labels[1])] = it
                elif t == "module" and labels:
                    self.submods[labels[0]] = it
                elif t == "locals":
                    self.locals.update(attrs(body))
                elif t == "variable" and labels:
                    self.variables[labels[0]] = attrs(body)
                elif t == "output" and labels:
                    self.outputs[labels[0]] = attrs(body)

    def fork(self, env):
        c = Ctx(self.name, self.tree, self.folder, self.files, {"environment": env}, self.bound, self.key_prefix)
        c.tfvars = self.tfvars
        c.account = getattr(self, "account", None)
        return c

    # --- variables
    def var(self, name):
        if self.env_override and name in self.env_override:
            return self.env_override[name]
        if self.bound is not None:
            if name in self.bound:
                return self.bound[name]
            d = self.variables.get(name, {})
            if "default" in d:
                return self.ev(d["default"], {})
            return Unknown("input %s not given" % name)
        if name in self.tfvars:
            return self.ev(self.tfvars[name], {})
        d = self.variables.get(name)
        if d is not None and "default" in d:
            return self.ev(d["default"], {})
        return Unknown("variable %s has no value" % name)

    def local(self, name):
        if name in self._local_cache:
            return self._local_cache[name]
        if name not in self.locals or name in self._busy:
            return Unknown("local %s" % name)
        self._busy.add(name)
        try:
            v = self.ev(self.locals[name], {})
        finally:
            self._busy.discard(name)
        self._local_cache[name] = v
        return v

    @property
    def region(self):
        v = self.var("aws_region")
        return v if isinstance(v, str) else "af-south-1"

    @property
    def acct(self):
        v = self.var("aws_account_id")
        return v if isinstance(v, str) else "000000000000"

    # --- evaluation
    def ev(self, e, sc):
        t = e[0]
        if t in ("lit", "str"):
            return e[1]
        if t == "tmpl":
            out = []
            for p in e[1]:
                if isinstance(p, str):
                    out.append(p)
                    continue
                v = self.ev(p, sc)
                if unk(v):
                    return v
                if isinstance(v, bool):
                    v = "true" if v else "false"
                if v is None or isinstance(v, (list, dict, DocRef)):
                    return Unknown("template of a non-text value")
                out.append(str(v))
            return "".join(out)
        if t == "unk":
            return Unknown(e[1])
        if t == "list":
            return [self.ev(x, sc) for x in e[1]]
        if t == "obj":
            d = {}
            for k, v in e[1]:
                kk = self.ev(k, sc)
                if unk(kk):
                    return Unknown("object key not readable")
                d[str(kk)] = self.ev(v, sc)
            return d
        if t == "cond":
            c = self.ev(e[1], sc)
            if unk(c) or not isinstance(c, bool):
                return Unknown("condition not readable")
            return self.ev(e[2] if c else e[3], sc)
        if t == "not":
            v = self.ev(e[1], sc)
            return v if unk(v) else (not v if isinstance(v, bool) else Unknown("not a bool"))
        if t == "neg":
            v = self.ev(e[1], sc)
            return v if unk(v) or not isinstance(v, (int, float)) else -v
        if t == "bin":
            return self.binop(e, sc)
        if t == "call":
            return self.call(e[1], [self.ev(a, sc) for a in e[2]], e[2], sc)
        if t == "for":
            return self.for_(e, sc)
        if t in ("id", "attr", "index", "splat"):
            return self.ref(e, sc)
        return Unknown("expression")

    def binop(self, e, sc):
        op = e[1]
        a = self.ev(e[2], sc)
        if op == "&&" and a is False:
            return False
        if op == "||" and a is True:
            return True
        b = self.ev(e[3], sc)
        if unk(a):
            return a
        if unk(b):
            return b
        try:
            if op == "==":
                return a == b
            if op == "!=":
                return a != b
            if op == "&&":
                return bool(a) and bool(b)
            if op == "||":
                return bool(a) or bool(b)
            if op == "<":
                return a < b
            if op == ">":
                return a > b
            if op == "<=":
                return a <= b
            if op == ">=":
                return a >= b
            if op == "+":
                return a + b
            if op == "-":
                return a - b
            if op == "*":
                return a * b
            if op == "/":
                return a / b
            if op == "%":
                return a % b
        except TypeError:
            return Unknown("operands")
        return Unknown("operator")

    def for_(self, e, sc):
        _, vars_, coll, k, v, cond = e
        c = self.ev(coll, sc)
        if unk(c):
            return c
        if isinstance(c, dict):
            pairs = list(c.items())
        elif isinstance(c, list):
            pairs = list(enumerate(c))
        else:
            return Unknown("for over a non-collection")
        out_l, out_d = [], {}
        for key, val in pairs:
            s2 = dict(sc)
            if len(vars_) == 2:
                s2[vars_[0]], s2[vars_[1]] = key, val
            else:
                s2[vars_[0]] = val
            if cond is not None:
                cv = self.ev(cond, s2)
                if unk(cv):
                    return cv
                if not cv:
                    continue
            if k is None:
                out_l.append(self.ev(v, s2))
            else:
                kk = self.ev(k, s2)
                if unk(kk):
                    return kk
                out_d[str(kk)] = self.ev(v, s2) if v is not None else None
        return out_l if k is None else out_d

    def call(self, name, args, raw, sc):
        if name == "jsonencode":
            return args[0] if args else Unknown("jsonencode")
        if name in ("toset", "tolist", "distinct", "flatten", "compact", "sort"):
            if not args or unk(args[0]):
                return args[0] if args else Unknown(name)
            v = args[0]
            if name == "flatten" and isinstance(v, list):
                out = []
                for x in v:
                    out.extend(x if isinstance(x, list) else [x])
                return out
            if isinstance(v, list):
                if name == "compact":
                    return [x for x in v if x]
                seen, out = [], []
                for x in v:
                    if not any(isinstance(y, type(x)) and y == x for y in seen):
                        seen.append(x)
                        out.append(x)
                return out
            return v
        if name == "concat":
            out = []
            for a in args:
                if unk(a):
                    return a
                if not isinstance(a, list):
                    return Unknown("concat of a non-list")
                out.extend(a)
            return out
        if name == "merge":
            out = {}
            for a in args:
                if unk(a):
                    return a
                if not isinstance(a, dict):
                    return Unknown("merge of a non-map")
                out.update(a)
            return out
        if name == "one":
            a = args[0] if args else Unknown("one")
            if unk(a):
                return a
            return a[0] if isinstance(a, list) and len(a) == 1 else (None if a == [] else Unknown("one"))
        if name == "length":
            a = args[0] if args else Unknown("length")
            return a if unk(a) else (len(a) if isinstance(a, (list, dict, str)) else Unknown("length"))
        if name == "lookup" and len(args) >= 2:
            m, k = args[0], args[1]
            if unk(m) or unk(k) or not isinstance(m, dict):
                return Unknown("lookup")
            return m.get(k, args[2] if len(args) > 2 else Unknown("lookup"))
        if name == "keys" and args and isinstance(args[0], dict):
            return list(args[0].keys())
        if name == "values" and args and isinstance(args[0], dict):
            return list(args[0].values())
        if name == "join" and len(args) == 2 and isinstance(args[1], list) and all(isinstance(x, str) for x in args[1]) and isinstance(args[0], str):
            return args[0].join(args[1])
        if name == "lower" and args and isinstance(args[0], str):
            return args[0].lower()
        if name == "contains" and len(args) == 2 and isinstance(args[0], list):
            return args[1] in args[0]
        if name == "file" and args and isinstance(args[0], str):
            rel = self.rel(args[0])
            return self.tree.read(rel) if self.tree.exists(rel) else Unknown("file not found")
        if name == "templatefile" and args and isinstance(args[0], str):
            rel = self.rel(args[0])
            if not self.tree.exists(rel):
                return Unknown("file not found")
            return TemplateText(self.tree.read(rel))
        if name == "format" and args and all(isinstance(a, (str, int)) for a in args):
            try:
                return args[0] % tuple(args[1:])
            except (TypeError, ValueError):
                return Unknown("format")
        return Unknown("function %s" % name)

    def rel(self, p):
        p = p.replace("\\", "/")
        if p.startswith("./"):
            p = p[2:]
        return (self.folder + "/" + p).replace("//", "/") if self.folder else p

    # --- references
    def ref(self, e, sc):
        segs = []
        cur = e
        while cur[0] in ("attr", "index", "splat"):
            if cur[0] == "attr":
                segs.append(("a", cur[2]))
                cur = cur[1]
            elif cur[0] == "index":
                segs.append(("i", cur[2]))
                cur = cur[1]
            else:
                segs.append(("s", None))
                cur = cur[1]
        segs.reverse()
        if cur[0] != "id":
            base = self.ev(cur, sc)
            return self.apply(base, segs, sc)
        root = cur[1]
        if root in sc:
            return self.apply(sc[root], segs, sc)
        if root == "var" and segs and segs[0][0] == "a":
            return self.apply(self.var(segs[0][1]), segs[1:], sc)
        if root == "local" and segs and segs[0][0] == "a":
            return self.apply(self.local(segs[0][1]), segs[1:], sc)
        if root == "path":
            return "."
        if root == "data" and len(segs) >= 2:
            return self.apply(self.data_attr(segs, sc), [], sc) if len(segs) <= 3 else Unknown("data")
        if root == "module" and segs and segs[0][0] == "a":
            rest = list(segs[1:])
            while rest and rest[0][0] == "i":
                rest = rest[1:]
            if rest and rest[0][0] == "a":
                return self.apply(self.module_output(segs[0][1], rest[0][1]), rest[1:], sc)
            return Unknown("module reference")
        if root.startswith("aws_") and segs and segs[0][0] == "a":
            rest = [s for s in segs[1:]]
            while rest and rest[0][0] == "i":
                rest = rest[1:]
            if rest and rest[0][0] == "a":
                return self.apply(self.res_attr(root, segs[0][1], rest[0][1]), rest[1:], sc)
        return Unknown("reference %s" % root)

    def apply(self, v, segs, sc):
        for kind, x in segs:
            if unk(v):
                return v
            if kind == "a":
                if isinstance(v, dict) and x in v:
                    v = v[x]
                elif isinstance(v, DocRef) and x == "json":
                    return v
                else:
                    return Unknown("attribute %s" % x)
            elif kind == "i":
                k = self.ev(x, sc)
                if unk(k):
                    return k
                try:
                    v = v[k]
                except (KeyError, IndexError, TypeError):
                    return Unknown("index")
            else:
                return Unknown("splat")
        return v

    def data_attr(self, segs, sc):
        typ, name = segs[0][1], segs[1][1]
        attr = segs[2][1] if len(segs) > 2 else None
        if typ == "aws_caller_identity":
            return self.acct if attr == "account_id" else Unknown("data")
        if typ == "aws_region":
            return self.region if attr in ("name", "id", "region") else Unknown("data")
        blk = self.data.get((typ, name))
        if blk is None:
            return Unknown("data %s.%s" % (typ, name))
        if typ == "aws_iam_policy_document" and attr == "json":
            return DocRef(self, blk)
        if typ == "aws_kms_key":
            kid = self.ev(attrs(blk[3]).get("key_id", ("lit", None)), sc)
            if unk(kid) or not isinstance(kid, str):
                return Unknown("key id not readable")
            if attr == "arn":
                return "arn:aws:kms:%s:%s:key/%s" % (self.region, self.acct, kid)
            if attr in ("id", "key_id"):
                return kid
        return Unknown("data %s.%s" % (typ, name))

    def module_output(self, mod, out):
        blk = self.submods.get(mod)
        if blk is None:
            return Unknown("module %s" % mod)
        child = self.child_ctx(mod)
        if child is None:
            return Unknown("module %s folder" % mod)
        o = child.outputs.get(out)
        if o is None or "value" not in o:
            return Unknown("module output %s" % out)
        return child.ev(o["value"], {})

    def child_ctx(self, mod):
        if hasattr(self, "_children") and mod in self._children:
            return self._children[mod]
        if not hasattr(self, "_children"):
            self._children = {}
        blk = self.submods[mod]
        a = attrs(blk[3])
        src = self.ev(a.get("source", ("lit", None)), {})
        if not isinstance(src, str) or not src.startswith("."):
            self._children[mod] = None
            return None
        folder = os.path.normpath((self.folder + "/" + src) if self.folder else src).replace(os.sep, "/")
        files = load_folder(self.tree, folder)
        bound = {}
        for k, ex in a.items():
            if k in ("source", "count", "for_each", "depends_on", "providers"):
                continue
            bound[k] = self.ev(ex, {})
        child = Ctx(self.name + ":" + mod, self.tree, folder, files, self.env_override, bound, self.key_prefix + "module.%s." % mod)
        self._children[mod] = child
        return child

    # --- what a resource's attribute is
    def res_name(self, typ, name):
        blk = self.resources.get((typ, name))
        if blk is None:
            return Unknown("resource %s.%s" % (typ, name))
        a = attrs(blk[3])
        field = {"aws_s3_bucket": "bucket", "aws_lambda_function": "function_name"}.get(typ, "name")
        if field not in a:
            return Unknown("no %s" % field)
        return self.ev(a[field], {})

    def res_attr(self, typ, name, attr):
        blk = self.resources.get((typ, name))
        if blk is None:
            return Unknown("resource %s.%s" % (typ, name))
        a = attrs(blk[3])
        nm = self.res_name(typ, name)
        r, ac = self.region, self.acct
        if typ == "aws_kms_key":
            tok = self.key_prefix + "aws_kms_key.%s" % name
            if attr == "arn":
                return "arn:aws:kms:%s:%s:key/%s" % (r, ac, tok)
            if attr in ("key_id", "id"):
                return tok
            return Unknown("kms attr")
        if unk(nm):
            return nm
        if typ == "aws_iam_role":
            path = self.ev(a["path"], {}) if "path" in a else "/"
            if not isinstance(path, str):
                return Unknown("role path")
            if attr == "arn":
                return "arn:aws:iam::%s:role%s%s" % (ac, path, nm)
            if attr in ("name", "id"):
                return nm
        elif typ == "aws_dynamodb_table":
            if attr == "arn":
                return "arn:aws:dynamodb:%s:%s:table/%s" % (r, ac, nm)
            if attr in ("name", "id"):
                return nm
        elif typ == "aws_s3_bucket":
            if attr == "arn":
                return "arn:aws:s3:::%s" % nm
            if attr in ("id", "bucket"):
                return nm
        elif typ == "aws_sqs_queue":
            if attr == "arn":
                return "arn:aws:sqs:%s:%s:%s" % (r, ac, nm)
            if attr in ("url", "id"):
                return "https://sqs.%s.amazonaws.com/%s/%s" % (r, ac, nm)
            if attr == "name":
                return nm
        elif typ == "aws_secretsmanager_secret":
            if attr in ("arn", "id"):
                return "arn:aws:secretsmanager:%s:%s:secret:%s" % (r, ac, nm)
            if attr == "name":
                return nm
        elif typ == "aws_lambda_function":
            if attr in ("arn", "invoke_arn"):
                return "arn:aws:lambda:%s:%s:function:%s" % (r, ac, nm)
            if attr in ("function_name", "id"):
                return nm
        elif typ == "aws_iam_policy":
            if attr in ("arn", "id"):
                return "arn:aws:iam::%s:policy/%s" % (ac, nm)
        return Unknown("%s.%s.%s" % (typ, name, attr))


class TemplateText(str):
    """The text of a template file; its ${...} parts are not worked out."""


def load_folder(tree, folder):
    out = []
    for rel in tree.files(folder):
        if rel.count("/") == folder.count("/") + 1 and rel.endswith(".tf"):
            try:
                out.append((rel, parse_hcl(tree.read(rel), rel)))
            except HclError as ex:
                raise HclError("cannot read %s: %s" % (rel, ex))
    return out


def load_tfvars(tree, folder):
    rel = folder + "/env/dev.tfvars"
    if not tree.exists(rel):
        return {}
    return attrs(parse_hcl(tree.read(rel), rel))


# ----------------------------------------------------------------------------
# IAM: statements, roles, keys
# ----------------------------------------------------------------------------
def as_list(v):
    if isinstance(v, list):
        return v
    return [v]


class Stmt:
    def __init__(self):
        self.effect = "Allow"
        self.actions = []
        self.resources = []
        self.res_unknown = False
        self.principals = []
        self.princ_unknown = False
        self.conditions = []
        self.cond_unknown = False
        self.unreadable = None
        self.sid = ""


def stmt_from_dict(d):
    s = Stmt()
    if not isinstance(d, dict):
        s.unreadable = "statement not readable"
        return s
    s.sid = d.get("Sid") if isinstance(d.get("Sid"), str) else ""
    s.effect = d.get("Effect", "Allow")
    if unk(s.effect):
        s.unreadable = "effect not readable"
        return s
    if s.effect != "Allow":
        s.unreadable = "a %s statement" % s.effect
        return s
    if "NotAction" in d or "NotResource" in d or "NotPrincipal" in d:
        s.unreadable = "NotAction/NotResource"
        return s
    acts = d.get("Action", [])
    if unk(acts):
        s.unreadable = "action not readable"
        return s
    s.actions = []
    for a in as_list(acts):
        if unk(a) or not isinstance(a, str):
            s.unreadable = "action not readable"
            return s
        s.actions.append(a)
    res = d.get("Resource", [])
    if unk(res):
        s.res_unknown = True
    else:
        for r in as_list(res):
            if unk(r) or not isinstance(r, str):
                s.res_unknown = True
            else:
                s.resources.append(r)
    pr = d.get("Principal")
    if pr is not None:
        if unk(pr):
            s.princ_unknown = True
        elif isinstance(pr, dict):
            for v in pr.values():
                for x in as_list(v):
                    if unk(x) or not isinstance(x, str):
                        s.princ_unknown = True
                    else:
                        s.principals.append(x)
        elif pr == "*":
            s.principals.append("*")
    cond = d.get("Condition")
    if cond is not None:
        if unk(cond) or not isinstance(cond, dict):
            s.cond_unknown = True
        else:
            for test, m in cond.items():
                if unk(m) or not isinstance(m, dict):
                    s.cond_unknown = True
                    continue
                for var, vals in m.items():
                    vs = [x for x in as_list(vals)]
                    if any(unk(x) or not isinstance(x, str) for x in vs):
                        s.cond_unknown = True
                    else:
                        s.conditions.append((test, var, vs))
    return s


def stmts_from_doc_block(ctx, blk, sc=None):
    """Statements of a data "aws_iam_policy_document" block."""
    sc = sc or {}
    out = []
    for it in blk[3]:
        if it[0] != "block":
            continue
        if it[1] == "statement":
            out.append(stmt_from_block(ctx, it[3], sc))
        elif it[1] == "dynamic" and it[2] == ["statement"]:
            a = attrs(it[3])
            coll = ctx.ev(a["for_each"], sc) if "for_each" in a else Unknown("dynamic")
            content = blocks(it[3], "content")
            if unk(coll) or not content:
                s = Stmt()
                s.unreadable = "dynamic statement not readable"
                out.append(s)
                continue
            items = list(coll.items()) if isinstance(coll, dict) else list(enumerate(coll))
            for k, v in items:
                s2 = dict(sc)
                s2["statement"] = {"key": k, "value": v}
                out.append(stmt_from_block(ctx, content[0][3], s2))
    return out


def stmt_from_block(ctx, body, sc):
    a = attrs(body)
    d = {}
    for k_hcl, k_json in (("sid", "Sid"), ("effect", "Effect"), ("actions", "Action"), ("resources", "Resource"),
                          ("not_actions", "NotAction"), ("not_resources", "NotResource")):
        if k_hcl in a:
            d[k_json] = ctx.ev(a[k_hcl], sc)
    if "effect" not in a:
        d["Effect"] = "Allow"
    princ = {}
    for pb in blocks(body, "principals"):
        pa = attrs(pb[3])
        ids = ctx.ev(pa.get("identifiers", ("list", [])), sc)
        typ = ctx.ev(pa.get("type", ("str", "AWS")), sc)
        princ.setdefault(typ if isinstance(typ, str) else "?", [])
        if unk(ids):
            princ[typ if isinstance(typ, str) else "?"].append(Unknown("identifiers"))
        else:
            princ[typ if isinstance(typ, str) else "?"].extend(as_list(ids))
    if princ:
        d["Principal"] = princ
    cond = {}
    for cb in blocks(body, "condition"):
        ca = attrs(cb[3])
        test, var, vals = (ctx.ev(ca.get(x, ("lit", None)), sc) for x in ("test", "variable", "values"))
        if unk(test) or unk(var):
            cond = Unknown("condition")
            break
        cond.setdefault(test, {})[var] = vals
    if cond:
        d["Condition"] = cond
    return stmt_from_dict(d)


def statements_of(ctx, value):
    """Statements from a policy value: a jsonencode map or a policy document."""
    if isinstance(value, DocRef):
        return stmts_from_doc_block(value.ctx, value.block)
    if isinstance(value, TemplateText):
        value = str(value)
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            s = Stmt()
            s.unreadable = "policy text not readable"
            return [s]
    if isinstance(value, dict):
        st = value.get("Statement", [])
        if unk(st):
            s = Stmt()
            s.unreadable = "statements not readable"
            return [s]
        return [stmt_from_dict(x) for x in as_list(st)]
    s = Stmt()
    s.unreadable = "policy not readable"
    return [s]


def iam_match(pattern, value):
    rx = "".join(".*" if c == "*" else "." if c == "?" else re.escape(c) for c in pattern)
    return re.fullmatch(rx, value, re.IGNORECASE) is not None


def action_match(stmt_actions, action):
    return any(iam_match(a, action) for a in stmt_actions)


# ----------------------------------------------------------------------------
# What the check knows about the setup files
# ----------------------------------------------------------------------------
class Role:
    def __init__(self, name, arn, folder):
        self.name = name
        self.arn = arn
        self.folder = folder
        self.stmts = []
        self.unreadable = []  # reasons: some policy of this role could not be read
        self.managed_unknown = []


class Locked:
    """A table, bucket, queue or secret and the key that locks it (or None)."""

    def __init__(self, kind, names, key, key_note, extra=None, where=""):
        self.kind = kind
        self.names = names
        self.key = key
        self.key_note = key_note
        self.extra = extra or {}
        self.where = where


class KeyInfo:
    def __init__(self, token, stmts, where):
        self.token = token
        self.stmts = stmts
        self.where = where
        self.root_stmt = any(
            (not s.unreadable) and "*" not in ("",) and any(p.endswith(":root") for p in s.principals)
            and any(a.lower() == "kms:*" for a in s.actions)
            for s in stmts
        )


def key_token_of(arn_or_id, world):
    if not isinstance(arn_or_id, str):
        return None, "key not readable"
    kid = arn_or_id.split("key/", 1)[1] if "key/" in arn_or_id else arn_or_id
    if kid in world.keys:
        return kid, None
    if kid in world.known_keys:
        return world.known_keys[kid], None
    if re.fullmatch(r"[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}", kid):
        return None, "key id not known"
    return None, "key not in the setup files"


MARKETPLACE = ("aws-marketplace:ViewSubscriptions", "aws-marketplace:Subscribe")
LOGS_ONLY_MANAGED = ("AWSLambdaBasicExecutionRole", "AWSLambdaVPCAccessExecutionRole", "AWSXRayDaemonWriteAccess")


class World:
    def __init__(self, tree, known_keys=None):
        self.tree = tree
        self.known_keys = known_keys or {}
        self.ctxs = []
        self.roles = {}
        self.lambdas = {}      # function name -> dict
        self.workflows = []
        self.tables = []
        self.buckets = []
        self.queues = []
        self.secrets = []
        self.keys = {}
        self.grants = []
        self.notes = []
        self.global_unreadable = []
        self.fork_names = {}
        self.build()

    # ---- load
    def build(self):
        folders = [f for f in ("infra", "talent-flow-infra") if self.tree.dirs(f) is not None and self.tree.files(f)]
        for f in folders:
            files = load_folder(self.tree, f)
            ctx = Ctx(f, self.tree, f, files)
            ctx.tfvars = load_tfvars(self.tree, f)
            self.ctxs.append(ctx)
        prods = []
        for c in self.ctxs:
            p = c.fork("prod")
            p.tfvars = c.tfvars
            prods.append(p)
        self.prod_ctxs = prods
        for c in self.ctxs:
            self.read_roles(c)
        for c in self.ctxs:
            self.read_keys(c)
        for c, p in zip(self.ctxs, self.prod_ctxs):
            self.read_locked(c, p)
            self.read_lambdas(c)
            self.read_policies(c)
            self.read_workflows(c)
            self.read_grants(c)

    def names_of(self, ctx, prod, typ, name):
        out = []
        for cx in (ctx, prod):
            v = cx.res_name(typ, name)
            if isinstance(v, str) and v not in out:
                out.append(v)
        return out

    def read_roles(self, ctx):
        for (typ, name), blk in ctx.resources.items():
            if typ != "aws_iam_role":
                continue
            nm = ctx.res_name(typ, name)
            arn = ctx.res_attr(typ, name, "arn")
            if isinstance(nm, str) and isinstance(arn, str):
                self.roles[nm] = Role(nm, arn, ctx.folder)
            else:
                self.notes.append("role %s.%s: name not readable" % (typ, name))

    def read_keys(self, ctx):
        todo = [(ctx, "")]
        for mod in ctx.submods:
            child = ctx.child_ctx(mod)
            if child is not None and any(t == "aws_kms_key" for (t, _) in child.resources):
                todo.append((child, mod))
        for cx, _ in todo:
            for (typ, name), blk in cx.resources.items():
                if typ != "aws_kms_key":
                    continue
                tok = cx.key_prefix + "aws_kms_key.%s" % name
                a = attrs(blk[3])
                pol = cx.ev(a["policy"], {}) if "policy" in a else Unknown("no policy")
                stmts = statements_of(cx, pol)
                self.keys[tok] = KeyInfo(tok, stmts, "%s:%d" % (cx.file_of.get(("resource", typ, name), cx.folder), blk[4]))

    def read_locked(self, ctx, prod):
        for (typ, name), blk in ctx.resources.items():
            a = attrs(blk[3])
            where = "%s:%d" % (ctx.file_of[("resource", typ, name)], blk[4])
            if typ == "aws_dynamodb_table":
                names = self.names_of(ctx, prod, typ, name)
                key, note = None, None
                for sse in blocks(blk[3], "server_side_encryption"):
                    sa = attrs(sse[3])
                    if "kms_key_arn" in sa:
                        v = ctx.ev(sa["kms_key_arn"], {})
                        if unk(v):
                            key, note = None, "key not readable"
                            key = "?"
                        else:
                            key, note = key_token_of(v, self)
                            if key is None:
                                key = "?"
                gsi = []
                for g in blocks(blk[3], "global_secondary_index"):
                    gv = ctx.ev(attrs(g[3]).get("name", ("lit", None)), {})
                    if isinstance(gv, str):
                        gsi.append(gv)
                self.tables.append(Locked("table", names, key, note, {"gsi": gsi, "folder": ctx.folder}, where))
            elif typ == "aws_s3_bucket":
                names = self.names_of(ctx, prod, typ, name)
                self.buckets.append(Locked("bucket", names, None, None, {"addr": "aws_s3_bucket.%s" % name, "folder": ctx.folder}, where))
            elif typ == "aws_sqs_queue":
                key, note = None, None
                if "kms_master_key_id" in a:
                    v = ctx.ev(a["kms_master_key_id"], {})
                    key, note = key_token_of(v, self)
                    if key is None:
                        key = "?"
                self.queues.append(Locked("queue", self.names_of(ctx, prod, typ, name), key, note, {}, where))
            elif typ == "aws_secretsmanager_secret":
                key, note = None, None
                if "kms_key_id" in a:
                    v = ctx.ev(a["kms_key_id"], {})
                    key, note = key_token_of(v, self)
                    if key is None:
                        key = "?"
                self.secrets.append(Locked("secret", self.names_of(ctx, prod, typ, name), key, note, {}, where))
        for (typ, name), blk in ctx.resources.items():
            if typ != "aws_s3_bucket_server_side_encryption_configuration":
                continue
            a = attrs(blk[3])
            bname = ctx.ev(a.get("bucket", ("lit", None)), {})
            key, note = None, None
            for r in blocks(blk[3], "rule"):
                for d in blocks(r[3], "apply_server_side_encryption_by_default"):
                    da = attrs(d[3])
                    if "kms_master_key_id" in da:
                        v = ctx.ev(da["kms_master_key_id"], {})
                        key, note = key_token_of(v, self)
                        if key is None:
                            key = "?"
            for b in self.buckets:
                if isinstance(bname, str) and bname in b.names:
                    b.key, b.key_note = key, note

    def read_grants(self, ctx):
        for (typ, name), blk in ctx.resources.items():
            if typ != "aws_kms_grant":
                continue
            a = attrs(blk[3])
            kid = ctx.ev(a.get("key_id", ("lit", None)), {})
            tok = None
            if isinstance(kid, str):
                tok, _ = key_token_of(kid, self)
            grantee = ctx.ev(a.get("grantee_principal", ("lit", None)), {})
            ops = ctx.ev(a.get("operations", ("list", [])), {})
            cons = {}
            unreadable = False
            for cb in blocks(blk[3], "constraints"):
                ca = attrs(cb[3])
                if "encryption_context_subset" in ca:
                    v = ctx.ev(ca["encryption_context_subset"], {})
                    if isinstance(v, dict) and not any(unk(x) for x in v.values()):
                        cons.update(v)
                    else:
                        unreadable = True
                if "encryption_context_equals" in ca:
                    unreadable = True
            self.grants.append({"key": tok, "grantee": grantee if isinstance(grantee, str) else None,
                                "ops": ops if isinstance(ops, list) else [], "context": cons, "unreadable": unreadable})

    def read_lambdas(self, ctx):
        for (typ, name), blk in ctx.resources.items():
            if typ != "aws_lambda_function":
                continue
            a = attrs(blk[3])
            fname = ctx.ev(a.get("function_name", ("lit", None)), {})
            rarn = ctx.ev(a.get("role", ("lit", None)), {})
            handler = ctx.ev(a.get("handler", ("lit", None)), {})
            env, env_ok = {}, True
            for eb in blocks(blk[3], "environment"):
                v = ctx.ev(attrs(eb[3]).get("variables", ("obj", [])), {})
                if isinstance(v, dict):
                    env.update(v)
                else:
                    env_ok = False
            if not isinstance(fname, str):
                self.notes.append("function block %s.%s: name not readable" % (typ, name))
                continue
            role_name = rarn.rsplit("/", 1)[-1] if isinstance(rarn, str) else None
            self.lambdas[fname] = {"role": role_name, "handler": handler if isinstance(handler, str) else None, "env": env,
                                   "env_ok": env_ok, "where": "%s:%d" % (ctx.file_of[("resource", typ, name)], blk[4])}

    def attach(self, rolename_value, stmts, why_if_not, ctx_label):
        if isinstance(rolename_value, str) and rolename_value in self.roles:
            self.roles[rolename_value].stmts.extend(stmts)
            return
        if isinstance(rolename_value, str):
            self.notes.append("policy for unknown role %s (%s)" % (rolename_value, ctx_label))
            return
        # role not readable: any role could be the one
        self.global_unreadable.append(why_if_not)

    def read_policies(self, ctx):
        for (typ, name), blk in ctx.resources.items():
            if typ not in ("aws_iam_role_policy", "aws_iam_role_policy_attachment"):
                continue
            a = attrs(blk[3])
            label = "%s.%s" % (typ, name)
            insts = self.instances(ctx, a, label)
            if insts is None:
                # count / for_each could not be worked out: any role may hold this policy
                self.global_unreadable.append("%s (count or for_each not readable)" % label)
                continue
            for sc in insts:
                role = ctx.ev(a.get("role", ("lit", None)), sc)
                if typ == "aws_iam_role_policy":
                    pol = ctx.ev(a["policy"], sc) if "policy" in a else Unknown("no policy")
                    self.attach(role, statements_of(ctx, pol), "%s (role not readable)" % label, label)
                else:
                    parn = ctx.ev(a.get("policy_arn", ("lit", None)), sc)
                    self.attach_managed(ctx, role, parn, label)

    def attach_managed(self, ctx, role, parn, label):
        if not isinstance(role, str) or role not in self.roles:
            if not isinstance(role, str):
                self.global_unreadable.append("%s (role not readable)" % label)
            return
        if isinstance(parn, str):
            m = re.match(r"arn:aws:iam::aws:policy/(?:service-role/)?(.+)$", parn)
            if m and m.group(1) in LOGS_ONLY_MANAGED:
                return
            for (typ, nm), blk in ctx.resources.items():
                if typ == "aws_iam_policy" and ctx.res_attr(typ, nm, "arn") == parn:
                    pol = ctx.ev(attrs(blk[3]).get("policy", ("lit", None)), {})
                    self.roles[role].stmts.extend(statements_of(ctx, pol))
                    return
        self.roles[role].managed_unknown.append(parn if isinstance(parn, str) else "a managed policy")

    def instances(self, ctx, a, label):
        sc_list = [{}]
        if "count" in a:
            n = ctx.ev(a["count"], {})
            if not isinstance(n, int) or isinstance(n, bool):
                return None
            sc_list = [{"count": {"index": i}} for i in range(n)]
        if "for_each" in a:
            coll = ctx.ev(a["for_each"], {})
            if unk(coll):
                return None
            if isinstance(coll, dict):
                sc_list = [{"each": {"key": k, "value": v}} for k, v in coll.items()]
            elif isinstance(coll, list):
                sc_list = [{"each": {"key": x, "value": x}} for x in coll]
            else:
                return None
        return sc_list

    def read_workflows(self, ctx):
        for (typ, name), blk in ctx.resources.items():
            if typ != "aws_sfn_state_machine":
                continue
            a = attrs(blk[3])
            rarn = ctx.ev(a.get("role_arn", ("lit", None)), {})
            nm = ctx.ev(a.get("name", ("lit", None)), {})
            d = ctx.ev(a.get("definition", ("lit", None)), {})
            self.workflows.append({"name": nm if isinstance(nm, str) else "%s.%s" % (typ, name),
                                   "role": rarn.rsplit("/", 1)[-1] if isinstance(rarn, str) else None,
                                   "definition": d, "where": "%s:%d" % (ctx.file_of[("resource", typ, name)], blk[4])})

    # ---- lookups
    def find(self, kind, name):
        pool = {"table": self.tables, "bucket": self.buckets, "queue": self.queues, "secret": self.secrets}[kind]
        for x in pool:
            if name in x.names:
                return x
        return None

    # ---- role rights
    def role_allows(self, role, action, arn, ctx=None):
        """allowed | missing | ("cnj", why). arn None: the action alone is judged."""
        maybe = None
        for st in role.stmts:
            if st.unreadable:
                maybe = maybe or "a statement of the role is not readable (%s)" % st.unreadable
                continue
            if not action_match(st.actions, action):
                continue
            if st.cond_unknown:
                maybe = maybe or "a condition on the statement is not understood"
                continue
            applies = True
            for test, var, vals in st.conditions:
                if var in ("kms:ViaService", "kms:EncryptionContext:aws:s3:arn"):
                    continue
                if var == "cloudwatch:namespace" and ctx is not None and "cloudwatch:namespace" in ctx and test in ("StringEquals", "StringLike"):
                    v = ctx["cloudwatch:namespace"]
                    if v is None:
                        maybe = maybe or "namespace not readable"
                        applies = None
                        break
                    if (test == "StringEquals" and v in vals) or (test == "StringLike" and any(fnmatch.fnmatchcase(v, x) for x in vals)):
                        continue
                    applies = False
                    break
                maybe = maybe or "a condition on the statement is not understood"
                applies = None
                break
            if applies is not True:
                continue
            if arn is None:
                return "allowed"
            r = self.resource_covered(st, arn)
            if r == "yes":
                return "allowed"
            if r == "maybe":
                maybe = maybe or "object key or resource not readable"
        if maybe:
            return ("cnj", maybe)
        if role.managed_unknown:
            return ("cnj", "a managed policy is attached that the check does not know")
        extra = [g for g in self.global_unreadable]
        if extra:
            return ("cnj", "role has an unreadable policy: %s" % extra[0])
        return "missing"

    def resource_covered(self, st, arn):
        if isinstance(arn, tuple):  # ("s3 prefix unknown", bucket arn)
            bucket_arn = arn[1]
            for p in st.resources:
                if p == "*" or iam_match(p, bucket_arn + "/anything") and p.endswith("/*") and p.rstrip("*").rstrip("/") == bucket_arn:
                    return "yes"
                if p.startswith(bucket_arn + "/"):
                    return "maybe"
            return "maybe" if st.res_unknown else "no"
        for p in st.resources:
            if iam_match(p, arn):
                return "yes"
        return "maybe" if st.res_unknown else "no"

    # ---- key rights
    def key_allows(self, role, key_tok, action, via, context):
        """allowed | missing | ("cnj", why) for one kms action by role on a key."""
        k = self.keys.get(key_tok)
        if k is None:
            return ("cnj", "key %s not in the setup files" % key_tok)
        kact = "kms:" + action
        maybe = None
        for st in k.stmts:
            if st.unreadable:
                maybe = maybe or "key policy statement not readable (%s)" % st.unreadable
                continue
            if st.princ_unknown:
                maybe = maybe or "key policy principals not readable"
                continue
            if role.arn not in st.principals or not action_match(st.actions, kact):
                continue
            ok = self.conds_ok(st, via, context)
            if ok == "yes":
                return "allowed"
            if ok == "maybe":
                maybe = maybe or "a condition on the key policy statement is not understood"
        for g in self.grants:
            if g["key"] == key_tok and g["grantee"] == role.arn and action in g["ops"]:
                if g["unreadable"]:
                    maybe = maybe or "grant constraint not understood"
                elif not g["context"] or (context and all(context.get(x) == y for x, y in g["context"].items())):
                    return "allowed"
        if k.root_stmt:
            for st in role.stmts:
                if st.unreadable or not action_match(st.actions, kact):
                    continue
                hit = False
                for p in st.resources:
                    if p == "*" or p.endswith("key/" + key_tok):
                        hit = True
                    elif "key/" in p:
                        tok2, why = key_token_of(p, self)
                        if tok2 == key_tok:
                            hit = True
                        elif tok2 is None and why == "key id not known":
                            maybe = maybe or "key id not known (add it to the known keys of the exceptions file)"
                if not hit and not st.res_unknown:
                    continue
                ok = self.conds_ok(st, via, context)
                if hit and ok == "yes":
                    return "allowed"
                if ok == "maybe" or st.res_unknown:
                    maybe = maybe or "role statement on the key not fully readable"
        if maybe:
            return ("cnj", maybe)
        if role.managed_unknown or self.global_unreadable:
            return ("cnj", "role has an unreadable policy")
        return "missing"

    def conds_ok(self, st, via, context):
        if st.cond_unknown:
            return "maybe"
        for test, var, vals in st.conditions:
            if var == "kms:ViaService":
                if via is None or not any(iam_match(v, "%s.%s.amazonaws.com" % (via, "af-south-1")) for v in vals):
                    return "no"
            elif var in ("aws:SourceAccount", "aws:SourceArn", "kms:CallerAccount"):
                continue
            elif var.startswith("kms:EncryptionContext:"):
                key = var.split(":", 2)[2]
                if context and context.get(key) in vals:
                    continue
                return "maybe"
            else:
                return "maybe"
        return "yes"


# ----------------------------------------------------------------------------
# Reading the code
# ----------------------------------------------------------------------------
def strip_js(text):
    """Blank out comments, keep line breaks and quoted text, so offsets stay put."""
    out, i, n = [], 0, len(text)
    state = None
    while i < n:
        c = text[i]
        if state is None:
            if c == "/" and i + 1 < n and text[i + 1] == "/":
                j = text.find("\n", i)
                j = n if j < 0 else j
                out.append(" " * (j - i))
                i = j
                continue
            if c == "/" and i + 1 < n and text[i + 1] == "*":
                j = text.find("*/", i + 2)
                j = n if j < 0 else j + 2
                out.append("".join(ch if ch == "\n" else " " for ch in text[i:j]))
                i = j
                continue
            if c in "'\"`":
                state = c
            out.append(c)
            i += 1
            continue
        out.append(c)
        if c == "\\" and i + 1 < n:
            out.append(text[i + 1])
            i += 2
            continue
        if c == state:
            state = None
        i += 1
    return "".join(out)


def scan_balanced(text, i):
    """text[i] is an opening bracket; returns the index of its closing bracket (or -1)."""
    pairs = {"(": ")", "[": "]", "{": "}"}
    stack = [pairs[text[i]]]
    j, n = i + 1, len(text)
    while j < n and stack:
        c = text[j]
        if c in "'\"`":
            q = c
            j += 1
            while j < n and text[j] != q:
                if text[j] == "\\":
                    j += 1
                j += 1
        elif c in pairs:
            stack.append(pairs[c])
        elif c == stack[-1]:
            stack.pop()
            if not stack:
                return j
        j += 1
    return -1


def split_top(text, sep=","):
    parts, depth, cur, i, n = [], 0, [], 0, len(text)
    while i < n:
        c = text[i]
        if c in "'\"`":
            q = c
            cur.append(c)
            i += 1
            while i < n and text[i] != q:
                if text[i] == "\\":
                    cur.append(text[i])
                    i += 1
                cur.append(text[i])
                i += 1
            if i < n:
                cur.append(text[i])
            i += 1
            continue
        if c in "([{":
            depth += 1
        elif c in ")]}":
            depth -= 1
        if c == sep and depth == 0:
            parts.append("".join(cur))
            cur = []
        else:
            cur.append(c)
        i += 1
    if "".join(cur).strip():
        parts.append("".join(cur))
    return parts


SDK_SERVICE_PREFIX = {
    "lib-dynamodb": "dynamodb",
    "secrets-manager": "secretsmanager",
    "cognito-identity-provider": "cognito-idp",
    "cloudwatch-logs": "logs",
    "sfn": "states",
    "eventbridge": "events",
    "bedrock-runtime": "bedrock",
    "config-service": "config",
    "sesv2": "ses",
}
DDB_LIB = {"GetCommand": "GetItem", "PutCommand": "PutItem", "UpdateCommand": "UpdateItem", "DeleteCommand": "DeleteItem",
           "QueryCommand": "Query", "ScanCommand": "Scan", "BatchGetCommand": "BatchGetItem", "BatchWriteCommand": "BatchWriteItem"}
ACTION_RENAME = {"ConverseCommand": "InvokeModel", "ConverseStreamCommand": "InvokeModelWithResponseStream",
                 "InvokeCommand": "InvokeFunction"}
MODEL_ACTIONS = ("bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream")
# Helpers known to return their input with extra condition fields (the proof lines are in the spec, section 2.3, shape 6).
# S3 calls judged under another permission name (AWS has no s3:HeadObject permission).
S3_AS = {"s3:HeadObject": ["s3:GetObject"], "s3:ListObjectsV2": ["s3:ListBucket"], "s3:ListObjects": ["s3:ListBucket"],
         "s3:HeadBucket": ["s3:ListBucket"], "s3:CopyObject": ["s3:GetObject@source", "s3:PutObject"]}
PASS_THROUGH = {"scopeWrite": ("tf-tenant", "lambda/shared/tf-tenant.js"), "onlyOurs": (None, "lambda/reviewDocumentVerification/index.mjs")}
EXTS = (".js", ".mjs", ".cjs")


def sdk_action(pkg, cmd):
    m = re.match(r"@aws-sdk/(?:client-)?([\w-]+)$", pkg)
    if not m:
        return None
    svc = m.group(1)
    prefix = SDK_SERVICE_PREFIX.get(svc, svc)
    if svc == "lib-dynamodb":
        act = DDB_LIB.get(cmd)
    elif cmd in ACTION_RENAME:
        act = ACTION_RENAME[cmd]
    elif cmd.endswith("Command"):
        act = cmd[:-7]
    else:
        return None
    if act is None:
        return None
    return "%s:%s" % (prefix, act), svc


class JsFile:
    def __init__(self, rel, raw):
        self.rel = rel
        self.text = strip_js(raw)
        self.imports = {}    # local name -> (specifier, imported name)
        self.follow = []     # relative specifiers loaded (import, require, import())
        self.dynamic = []    # offsets of import( with a non-literal path
        self.consts = {}
        self.funcs = []      # (name, params, body_start, body_end)
        self.parse()

    def line(self, off):
        return self.text.count("\n", 0, off) + 1

    def parse(self):
        t = self.text
        for m in re.finditer(r"""\bimport\s+(?:([\w$]+)\s*,?\s*)?(?:\{([^}]*)\}|\*\s+as\s+([\w$]+))?\s*from\s*(['"])([^'"]+)\4""", t):
            spec = m.group(5)
            self.follow.append(spec)
            if m.group(1):
                self.imports[m.group(1)] = (spec, "default")
            if m.group(3):
                self.imports[m.group(3)] = (spec, "*")
            for part in (m.group(2) or "").split(","):
                part = part.strip()
                if not part:
                    continue
                mm = re.match(r"([\w$]+)(?:\s+as\s+([\w$]+))?$", part)
                if mm:
                    self.imports[mm.group(2) or mm.group(1)] = (spec, mm.group(1))
        for m in re.finditer(r"""(?:const|let|var)\s+(?:\{([^}]*)\}|([\w$]+))\s*=\s*(?:await\s+)?(?:require|import)\(\s*(['"])([^'"]+)\3\s*\)""", t):
            spec = m.group(4)
            self.follow.append(spec)
            if m.group(2):
                self.imports[m.group(2)] = (spec, "*")
            for part in (m.group(1) or "").split(","):
                part = part.strip()
                if not part:
                    continue
                mm = re.match(r"([\w$]+)(?:\s*:\s*([\w$]+))?(?:\s*=.*)?$", part)
                if mm:
                    self.imports[mm.group(2) or mm.group(1)] = (spec, mm.group(1))
        for m in re.finditer(r"""(?:\bawait\s+)?\bimport\(\s*(['"])([^'"]+)\1\s*\)""", t):
            if m.group(2) not in self.follow:
                self.follow.append(m.group(2))
        for m in re.finditer(r"""\bimport\(\s*(?!['"\s])""", t):
            self.dynamic.append(m.start())
        for m in re.finditer(r"""(?<![.\w$])require\(\s*(['"])([^'"]+)\1\s*\)""", t):
            if m.group(2) not in self.follow:
                self.follow.append(m.group(2))
        for m in re.finditer(r"""\b(?:const|let|var)\s+([\w$]+)\s*=\s*""", t):
            if m.group(1) not in self.consts:
                self.consts[m.group(1)] = m.end()
        self.find_funcs()

    def find_funcs(self):
        t = self.text
        pats = [
            r"""(?:async\s+)?function\s*\*?\s*([\w$]+)?\s*\(""",
            r"""\b(?:const|let|var)\s+([\w$]+)\s*=\s*(?:async\s*)?\(""",
            r"""\b(?:const|let|var)\s+([\w$]+)\s*=\s*(?:async\s+)?([\w$]+)\s*=>\s*\{""",
            r"""\b(?:const|let|var)\s+([\w$]+)\s*=\s*(?:async\s+)?([\w$]+)\s*=>\s*(?!\{)""",
        ]
        self.decl_offsets = set()
        for pi, p in enumerate(pats):
            for m in re.finditer(p, t):
                brace_less = False
                if pi == 2:
                    name, params = m.group(1), [m.group(2)]
                    j = m.end() - 1
                elif pi == 3:
                    name, params = m.group(1), [m.group(2)]
                    j = m.end()
                    brace_less = True
                else:
                    open_i = m.end() - 1
                    close_i = scan_balanced(t, open_i)
                    if close_i < 0:
                        continue
                    name = m.group(1)
                    params = []
                    for pr in split_top(t[open_i + 1:close_i]):
                        pm = re.match(r"\s*(?:\.\.\.)?([\w$]+)\s*(?:=.*)?$", pr, re.S)
                        params.append(pm.group(1) if pm else None)
                    k = close_i + 1
                    rest = t[k:k + 40]
                    if pi == 0:
                        mm = re.match(r"\s*\{", rest)
                        if not mm:
                            continue
                        j = k + mm.end() - 1
                    else:
                        mm = re.match(r"\s*=>\s*\{", rest)
                        if not mm:
                            mm = re.match(r"\s*=>\s*", rest)
                            if not mm or not name:
                                continue
                            j = k + mm.end()
                            brace_less = True
                        else:
                            j = k + mm.end() - 1
                if brace_less:
                    sp = self.const_span(name)
                    if sp is None or not (sp[0] <= j <= sp[1]):
                        continue
                    end = sp[1]
                else:
                    end = scan_balanced(t, j)
                if end < 0 or not name:
                    continue
                self.decl_offsets.add(m.start(1))
                self.funcs.append((name, params, j, end))

    def enclosing(self, off):
        best = None
        for f in self.funcs:
            if f[2] < off < f[3] and (best is None or f[2] > best[2]):
                best = f
        return best

    def const_expr(self, name):
        sp = self.const_span(name)
        if sp is None:
            return None
        return self.text[sp[0]:sp[1]].strip(), sp[0]

    def input_spans(self):
        """[(inputs text, start, end)] for every function with a body: named or inline, arrow, function or method.
        An arrow without braces runs to the next semicolon. Cached."""
        if hasattr(self, "_input_spans"):
            return self._input_spans
        t = self.text
        out = []
        inner = r"[^()]*(?:\([^()]*\)[^()]*)*"
        heads = (
            r"\(" + "(" + inner + ")" + r"\)\s*=>\s*",
            r"(?<![\w$.])([\w$]+)\s*=>\s*",
            r"\bfunction\b[^(){}]*\(" + "(" + inner + ")" + r"\)\s*(?=\{)",
            r"(?<![\w$.])(?!(?:if|for|while|switch|catch|function|return)\b)[\w$]+\s*\(" + "(" + inner + ")" + r"\)\s*(?=\{)",
        )
        for h in heads:
            for m in re.finditer(h, t):
                j = m.end()
                if j < len(t) and t[j] == "{":
                    e = scan_balanced(t, j)
                    if e < 0:
                        e = len(t)
                else:
                    e = t.find(";", j)
                    e = len(t) if e < 0 else e
                out.append((m.group(1), m.start(), e))
        self._input_spans = out
        return out

    def name_is_plain(self, name, off):
        """The one strict test before a name is read (spec 4b item 1, review of PR 569). The name must be declared exactly
        once in the file, as a const (not a let, var, function, class, an import, a catch or loop name or a name taken
        out of an object or list), never be an input (plain or destructured, named or inline function) of a function
        around the place it is used, and never be assigned again. Otherwise it may mean something else there, and the
        caller keeps could not judge."""
        t = self.text
        n = re.escape(name)
        for params, start, end in self.input_spans():
            if start <= off <= end and re.search(r"(?<![\w$.])%s\b" % n, params):
                return False
        decls = re.findall(r"\b(const|let|var)\s+%s\b" % n, t)
        if len(decls) != 1 or decls[0] != "const":
            return False
        other_binders = (
            r"\bfunction\s*\*?\s*%s\b" % n,
            r"\bclass\s+%s\b" % n,
            r"\b(?:const|let|var)\s*[\[{][^=;()]*\b%s\b[^=;()]*[\]}]\s*=" % n,
            r"\bcatch\s*\(\s*%s\b" % n,
            r"\bfor\s*\(\s*(?:const|let|var)\s+[\[{][^)]*\b%s\b" % n,
            r"(?<![\w$.])%s\s*(?:[-+*/%%&|^]|\?\?|\|\||&&|\*\*|<<|>>>?)=(?!=)" % n,
            r"\bimport\b[^;]*\b%s\b[^;]*\bfrom\b" % n,
        )
        if any(re.search(pat, t) for pat in other_binders):
            return False
        return len(re.findall(r"(?<![\w$.])%s\s*=(?![=>])" % n, t)) <= 1

    def const_span(self, name):
        if name not in self.consts:
            return None
        t, i = self.text, self.consts[name]
        j, n = i, len(t)
        depth = 0
        while j < n:
            c = t[j]
            if c in "'\"`":
                q = c
                j += 1
                while j < n and t[j] != q:
                    if t[j] == "\\":
                        j += 1
                    j += 1
            elif c in "([{":
                depth += 1
            elif c in ")]}":
                depth -= 1
                if depth < 0:
                    break
            elif c == ";" and depth == 0:
                break
            elif c == "\n" and depth == 0:
                rest = t[j:].lstrip()
                if not (rest.startswith("??") or rest.startswith("||") or rest.startswith("?") or rest.startswith(":")
                        or t[i:j].rstrip().endswith(("??", "||", "?", ":", "+"))):
                    break
            j += 1
        return i, j

    def outer_funcs(self):
        out = []
        for f in self.funcs:
            if not any(g is not f and g[2] <= f[2] and f[3] <= g[3] and (g[2], g[3]) != (f[2], f[3]) for g in self.funcs):
                if not any((g[2], g[3]) == (f[2], f[3]) for g in out):
                    out.append(f)
        return out

    def outermost(self, off):
        for f in self.outer_funcs_cache():
            if f[2] < off < f[3] or (f[2] == off and False):
                return f
        return None

    def outer_funcs_cache(self):
        if not hasattr(self, "_outer"):
            self._outer = self.outer_funcs()
        return self._outer

    def import_records(self):
        """(start, end, spec, kind, data): kind named {local: imported}, ns local, all None."""
        if hasattr(self, "_records"):
            return self._records
        t = self.text
        recs, used = [], set()
        for m in re.finditer(r"""\bimport\s+(?:([\w$]+)\s*,?\s*)?(?:\{([^}]*)\}|\*\s+as\s+([\w$]+))?\s*from\s*(['"])([^'"]+)\4""", t):
            spec = m.group(5)
            if m.group(3):
                recs.append((m.start(), m.end(), spec, "ns", m.group(3)))
            named = {}
            if m.group(1):
                named[m.group(1)] = "default"
            for part in (m.group(2) or "").split(","):
                mm = re.match(r"\s*([\w$]+)(?:\s+as\s+([\w$]+))?\s*$", part)
                if mm:
                    named[mm.group(2) or mm.group(1)] = mm.group(1)
            if named or not m.group(3):
                recs.append((m.start(), m.end(), spec, "named", named))
        for m in re.finditer(r"""\bimport\s*(['"])([^'"]+)\1""", t):
            recs.append((m.start(), m.end(), m.group(2), "all", None))
        for m in re.finditer(r"""\bexport\s+(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s*from\s*(['"])([^'"]+)\1""", t):
            recs.append((m.start(), m.end(), m.group(2), "all", None))
        for m in re.finditer(r"""(?:const|let|var)\s+(?:\{([^}]*)\}|([\w$]+))\s*=\s*(?:await\s+)?(?:require|import)\(\s*(['"])([^'"]+)\3\s*\)""", t):
            used.add(t.rfind("(", m.start(), m.start(4)))
            if m.group(2):
                recs.append((m.start(), m.end(), m.group(4), "ns", m.group(2)))
            else:
                named = {}
                for part in m.group(1).split(","):
                    mm = re.match(r"\s*([\w$]+)(?:\s*:\s*([\w$]+))?(?:\s*=.*)?\s*$", part, re.S)
                    if mm:
                        named[mm.group(2) or mm.group(1)] = mm.group(1)
                recs.append((m.start(), m.end(), m.group(4), "named", named))
        for m in re.finditer(r"""(?:const|let|var)\s*\[""", t):
            lo = m.end() - 1
            lc = scan_balanced(t, lo)
            if lc < 0:
                continue
            mm = re.match(r"""\s*=\s*await\s+Promise\.all\(\s*\[""", t[lc + 1:])
            if not mm:
                continue
            ao = lc + 1 + mm.end() - 1
            ac = scan_balanced(t, ao)
            if ac < 0:
                continue
            lefts = split_top(t[lo + 1:lc])
            rights = split_top(t[ao + 1:ac])
            for k, r in enumerate(rights):
                mr = re.match(r"""\s*import\(\s*(['"])([^'"]+)\1\s*\)\s*$""", r)
                if not mr:
                    continue
                spec = mr.group(2)
                pos = ao + 1 + sum(len(x) + 1 for x in rights[:k]) + r.index("import(") + len("import")
                left = lefts[k].strip() if k < len(lefts) else ""
                if left.startswith("{") and left.endswith("}"):
                    named = {}
                    for part in left[1:-1].split(","):
                        pm = re.match(r"\s*([\w$]+)(?:\s*:\s*([\w$]+))?(?:\s*=.*)?\s*$", part, re.S)
                        if pm:
                            named[pm.group(2) or pm.group(1)] = pm.group(1)
                    used.add(pos)
                    recs.append((m.start(), ac + 1, spec, "named", named))
                elif re.fullmatch(r"[\w$]+", left):
                    used.add(pos)
                    recs.append((m.start(), ac + 1, spec, "ns", left))
        for m in re.finditer(r"""(?<![.\w$])(?:import|require)(\()\s*(['"])([^'"]+)\2\s*\)""", t):
            if m.start(1) in used:
                continue
            recs.append((m.start(), m.start(), m.group(3), "all", None))
        # export lists and module.exports objects: names for aliases, not mentions
        self.export_alias = {}
        self.export_spans = []
        for m in re.finditer(r"""\bexport\s*\{([^}]*)\}(?!\s*from)""", t):
            self.export_spans.append((m.start(), m.end()))
            for part in m.group(1).split(","):
                mm = re.match(r"\s*([\w$]+)(?:\s+as\s+([\w$]+))?\s*$", part)
                if mm:
                    self.export_alias[mm.group(2) or mm.group(1)] = mm.group(1)
        for m in re.finditer(r"""\bmodule\.exports\s*=\s*\{""", t):
            cl = scan_balanced(t, m.end() - 1)
            if cl < 0:
                continue
            ents = split_top(t[m.end():cl])
            pairs = {}
            ok = True
            for e in ents:
                mm = re.match(r"\s*([\w$]+)\s*(?::\s*([\w$]+))?\s*$", e)
                if not mm:
                    ok = False
                    break
                pairs[mm.group(1)] = mm.group(2) or mm.group(1)
            if ok:
                self.export_spans.append((m.start(), cl + 1))
                self.export_alias.update(pairs)
        self._records = recs
        return recs


class Op:
    def __init__(self, action, svc, resource, res_why, where, params=None, note="", codefn=""):
        self.codefn = codefn
        self.action = action
        self.svc = svc
        self.resource = resource    # dict(kind=..., name=..., index=..., key=...) or None
        self.res_why = res_why      # why the resource could not be read, or None
        self.where = where
        self.params = params or {}
        self.note = note


class FunctionCode:
    """All the code one function runs: its own files plus shared files it loads."""

    def __init__(self, tree, name, folder, entry_files, env, env_ok):
        self.tree = tree
        self.name = name
        self.env = env
        self.env_ok = env_ok
        self.files = {}      # rel -> JsFile
        self.order = []
        self.shared_names = {}   # shared file -> names imported by those that load it ("*" for all)
        self.notes = []
        self.unreached = []
        for rel in entry_files:
            self.load(rel, 0, None)
        self.compute_reach()

    def load(self, rel, depth, names):
        if rel in self.files:
            if names is not None:
                self.shared_names.setdefault(rel, set()).update(names)
            elif names is None:
                pass
            return
        if not self.tree.exists(rel):
            return
        jf = JsFile(rel, self.tree.read(rel))
        self.files[rel] = jf
        self.order.append(rel)
        if names is not None:
            self.shared_names.setdefault(rel, set()).update(names)
        for off in jf.dynamic:
            self.notes.append(("could not judge: dynamic import", rel, jf.line(off)))
        if depth >= 3:
            return
        specs = list(jf.follow) + [r[2] for r in jf.import_records() if r[2] not in jf.follow]
        for spec in specs:
            if not spec.startswith("."):
                continue
            target = self.resolve_spec(rel, spec)
            if target:
                wanted = set()
                for local, (sp, imported) in jf.imports.items():
                    if sp == spec:
                        wanted.add(imported)
                self.load(target, depth + 1, wanted or {"*"})

    # ---- reach (W1): a shared file's function counts only when counted code names it
    def compute_reach(self):
        self.all_files = set(r for r in self.files if not r.startswith("lambda/shared/"))
        self.counted = {r: set() for r in self.files}
        todo = []
        for rel in self.files:
            todo.append((rel, None))
        for rel in list(self.all_files):
            for f in self.files[rel].outer_funcs_cache():
                self.counted[rel].add((f[2], f[3]))
                todo.append((rel, f))
        while todo:
            rel, f = todo.pop()
            for rel2, name in self.region_targets(rel, f):
                jf2 = self.files[rel2]
                if name is None:
                    if rel2 not in self.all_files:
                        self.all_files.add(rel2)
                        for g in jf2.outer_funcs_cache():
                            if (g[2], g[3]) not in self.counted[rel2]:
                                self.counted[rel2].add((g[2], g[3]))
                                todo.append((rel2, g))
                    continue
                for g in self.funcs_named(jf2, name):
                    o = jf2.outermost(g[2] + 1) or g
                    if (o[2], o[3]) not in self.counted[rel2]:
                        self.counted[rel2].add((o[2], o[3]))
                        todo.append((rel2, o))

    def funcs_named(self, jf, name):
        return [g for g in jf.funcs if g[0] == name]

    def tie(self, rel, spec, imported):
        """[(target, name or None for all)] for one imported name."""
        target = self.resolve_spec(rel, spec) if spec.startswith(".") else None
        if not target or target not in self.files:
            return []
        if imported in ("default", "*") or imported is None:
            return [(target, None)]
        jf2 = self.files[target]
        jf2.import_records()
        name = jf2.export_alias.get(imported, imported)
        if self.funcs_named(jf2, name):
            return [(target, name)]
        if name in jf2.consts or re.search(r"\bclass\s+%s\b" % re.escape(name), jf2.text):
            return []
        return [(target, None)]

    def region_targets(self, rel, f):
        jf = self.files[rel]
        t = jf.text
        recs = jf.import_records()
        if f is None:
            chars = list(t)
            for g in jf.outer_funcs_cache():
                for k in range(g[2], min(g[3], len(chars))):
                    if chars[k] != "\n":
                        chars[k] = " "
            lo, hi = 0, len(t)
        else:
            chars = list(t[:f[3]])
            lo, hi = f[2], f[3]
        for (a, b, _spec, kind, _d) in recs:
            if kind != "all":
                for k in range(a, min(b, len(chars))):
                    if chars[k] != "\n":
                        chars[k] = " "
        for (a, b) in jf.export_spans:
            for k in range(a, min(b, len(chars))):
                if chars[k] != "\n":
                    chars[k] = " "
        region = "".join(chars)
        out = []
        for (a, b, spec, kind, _d) in recs:
            if kind == "all" and lo <= a < hi and (f is not None or jf.outermost(a) is None):
                out.extend(self.tie(rel, spec, None))
        named, ns = {}, {}
        for (_a, _b, spec, kind, d) in recs:
            if kind == "named":
                for local, imp in d.items():
                    named.setdefault(local, []).append((spec, imp))
            elif kind == "ns":
                ns.setdefault(d, []).append(spec)
        local_funcs = {g[0] for g in jf.funcs}
        for m in re.finditer(r"(?<![\w$.])([A-Za-z_$][\w$]*)(?:\s*\.\s*([A-Za-z_$][\w$]*))?", region[lo:hi]):
            off = lo + m.start(1)
            n = m.group(1)
            if off in jf.decl_offsets:
                continue
            if n in ns:
                for spec in ns[n]:
                    out.extend(self.tie(rel, spec, m.group(2) if m.group(2) else None))
            elif n in named:
                for spec, imp in named[n]:
                    out.extend(self.tie(rel, spec, imp))
            elif n in local_funcs:
                out.append((rel, n))
        return out

    def is_counted(self, jf, off):
        if jf.rel in self.all_files:
            return True
        o = jf.outermost(off)
        if o is None:
            return True
        return (o[2], o[3]) in self.counted[jf.rel]

    def resolve_spec(self, rel, spec):
        base = os.path.normpath(os.path.join(os.path.dirname(rel), spec)).replace(os.sep, "/")
        cands = [base] + [base + e for e in EXTS] + [base + "/index" + e for e in EXTS]
        for c in cands:
            if self.tree.exists(c) and not c.endswith("/"):
                return c
        return None

    # ---- values
    def value(self, jf, text, off, binding, depth=0):
        """('lit', text) or ('unk', why) or ('cls', pkg, name)."""
        t = text.strip()
        while t.startswith("(") and scan_balanced(t, 0) == len(t) - 1:
            t = t[1:-1].strip()
        if not t:
            return ("unk", "empty")
        m = re.fullmatch(r"""(['"])((?:\\.|(?!\1).)*)\1""", t, re.S)
        if m:
            return ("lit", m.group(2))
        if t.startswith("`"):
            if t.endswith("`") and "${" not in t and t.count("`") == 2:
                return ("lit", t[1:-1])
            return ("unk", "name not readable (template string)")
        parts = [p for p in re.split(r"\s*(\?\?|\|\|)\s*", t, maxsplit=1)]
        if len(parts) == 3:
            first = self.value(jf, parts[0], off, binding, depth)
            if first[0] == "lit":
                return first
            return self.value(jf, parts[2], off, binding, depth)
        m = re.fullmatch(r"process\.env\.([A-Za-z_]\w*)|process\.env\[\s*(['\"])([^'\"]+)\2\s*\]", t)
        if m:
            nm = m.group(1) or m.group(3)
            v = self.env.get(nm)
            if isinstance(v, str):
                return ("lit", v)
            return ("unk", "setting %s not in Terraform" % nm)
        mg = re.fullmatch(r"([A-Za-z_$][\w$]*)\(\s*\)", t)
        if mg and depth < 6 and not (binding and mg.group(1) in binding):
            ce = jf.const_expr(mg.group(1)) if jf.name_is_plain(mg.group(1), off) else None
            if ce:
                mb = re.fullmatch(r"(?:async\s*)?\(\s*\)\s*=>\s*(.+)", ce[0], re.S)
                if mb:
                    inner = mb.group(1).strip()
                    if not inner.startswith("{"):
                        return self.value(jf, inner, ce[1], None, depth + 1)
                    g = re.fullmatch(r"\{\s*const\s+([A-Za-z_$][\w$]*)\s*=\s*process\.env\.([A-Za-z_]\w*)\s*;?\s*"
                                     r"(?:if\s*\(\s*!\s*\1\s*\)\s*throw\s+[^;{}]*;?\s*)?return\s+\1\s*;?\s*\}", inner, re.S)
                    if g:
                        return self.value(jf, "process.env." + g.group(2), ce[1], None, depth + 1)
            return ("unk", "name not readable (%s)" % t)
        mr = re.fullmatch(r"requireSetting\(\s*(['\"])([A-Za-z_]\w*)\1\s*\)", t)
        if mr and any(f[0] == "requireSetting" for f in jf.funcs):
            return self.value(jf, "process.env." + mr.group(2), off, None, depth + 1)
        mp = re.fullmatch(r"([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)", t)
        if mp and depth < 6 and not (binding and mp.group(1) in binding):
            ce = jf.const_expr(mp.group(1)) if jf.name_is_plain(mp.group(1), off) else None
            if ce and ce[0].lstrip().startswith("{"):
                props, _w = self.obj_props(jf, ce[0], ce[1], None, 3)
                if mp.group(2) in props:
                    return self.value(jf, props[mp.group(2)][0], props[mp.group(2)][1], None, depth + 1)
            return ("unk", "name not readable (%s)" % t)
        if re.fullmatch(r"[A-Za-z_$][\w$]*", t):
            if binding is not None and t in binding:
                return binding[t]
            fn = jf.enclosing(off)
            if fn and t in fn[1]:
                return ("param", t, fn, jf)
            ce = jf.const_expr(t) if jf.name_is_plain(t, off) else None
            if ce and depth < 6:
                return self.value(jf, ce[0], ce[1], binding, depth + 1)
            if t in jf.imports:
                pkg, nm = jf.imports[t]
                if pkg.startswith("@aws-sdk/"):
                    return ("cls", pkg, nm)
                if pkg.startswith(".") and nm not in ("*", "default") and depth < 6:
                    target = self.resolve_spec(jf.rel, pkg)
                    if target and target in self.files:
                        f2 = self.files[target]
                        ce2 = f2.const_expr(nm) if f2.consts.get(nm) is not None and f2.name_is_plain(nm, f2.consts[nm]) else None
                        if ce2:
                            return self.value(f2, ce2[0], ce2[1], None, depth + 1)
            return ("unk", "name not readable (%s)" % t)
        return ("unk", "name not readable")

    def pass_through(self, jf, name):
        spec = PASS_THROUGH.get(name)
        if spec is None:
            return False
        want_import, home = spec
        if jf.rel == home and any(f[0] == name for f in jf.funcs):
            return True
        imp = jf.imports.get(name)
        return bool(want_import and imp and want_import in imp[0])

    def obj_props(self, jf, arg, off, binding, depth=0):
        """Properties of an object literal given as text or through a variable: (dict key->(text, offset), problems)."""
        t = arg.strip()
        m = re.match(r"([\w$]+)\s*\(", t)
        if m and self.pass_through(jf, m.group(1)):
            op = t.index("(")
            cl = scan_balanced(t, op)
            inner = split_top(t[op + 1:cl])
            return self.obj_props(jf, inner[0], off, binding, depth) if inner else ({}, "empty call")
        if t.startswith("{"):
            cl = scan_balanced(t, 0)
            props, why = {}, None
            for ent in split_top(t[1:cl]):
                e = ent.strip()
                if e.startswith("..."):
                    sub, w = self.obj_props(jf, e[3:], off, binding, depth + 1) if depth < 4 else ({}, "deep")
                    for k, v in sub.items():
                        props.setdefault(k, v)
                    why = why or w
                    continue
                mm = re.match(r"""(?:([\w$]+)|(['"])([^'"]+)\2)\s*:\s*(.*)$""", e, re.S)
                if mm:
                    props[mm.group(1) or mm.group(3)] = (mm.group(4), off)
                    continue
                mm = re.match(r"([\w$]+)$", e)
                if mm:
                    props[mm.group(1)] = (mm.group(1), off)
                    continue
                mm = re.match(r"\[\s*([\w$.]+)\s*\]\s*:\s*(.*)$", e, re.S)
                if mm:
                    props["[%s]" % mm.group(1)] = (mm.group(2), off)
            return props, why
        if re.fullmatch(r"[A-Za-z_$][\w$]*", t):
            if binding is not None and t in binding and binding[t][0] == "obj":
                return binding[t][1], None
            ce = jf.const_expr(t)
            if ce and depth < 4:
                props, why = self.obj_props(jf, ce[0], ce[1], binding, depth + 1)
                # later assignments name.Key = value
                for mm in re.finditer(r"\b%s\.([A-Za-z_]\w*)\s*=\s*([^=;\n][^;\n]*)" % re.escape(t), jf.text):
                    props.setdefault(mm.group(1), (mm.group(2), mm.start()))
                return props, why
            fn = jf.enclosing(off)
            if fn and t in fn[1]:
                return {}, "input comes from outside the function"
        return {}, "input not readable"

    # ---- finding the calls
    def ops(self):
        out = []
        for rel in self.order:
            jf = self.files[rel]
            shared = rel.startswith("lambda/shared/")
            for m in re.finditer(r"\bnew\s+(?:([A-Za-z_$][\w$]*)\.)?([A-Za-z_$][\w$]*)\s*\(", jf.text):
                ns, cls = m.group(1), m.group(2)
                open_i = m.end() - 1
                close_i = scan_balanced(jf.text, open_i)
                if close_i < 0:
                    continue
                arg = jf.text[open_i + 1:close_i]
                pkg = None
                if ns and ns in jf.imports and jf.imports[ns][0].startswith("@aws-sdk/"):
                    pkg, cmd = jf.imports[ns][0], cls
                elif not ns and cls in jf.imports and jf.imports[cls][0].startswith("@aws-sdk/"):
                    pkg, cmd = jf.imports[cls][0], jf.imports[cls][1]
                if shared and not self.is_counted(jf, m.start()):
                    if pkg and cmd.endswith("Command"):
                        sa = sdk_action(pkg, cmd)
                        if sa:
                            efn = jf.enclosing(m.start())
                            for a in S3_AS.get(sa[0], [sa[0]]):
                                self.unreached.append((a.split("@")[0], "%s:%d" % (jf.rel, jf.line(m.start())), efn[0] if efn else "-"))
                    continue
                if pkg:
                    if not cmd.endswith("Command"):
                        continue
                    out.extend(self.make_ops(jf, pkg, cmd, arg, m.start(), None, shared))
                    continue
                fn = jf.enclosing(m.start())
                if fn and not ns and cls in fn[1]:
                    out.extend(self.helper_ops(jf, fn, cls, arg, m.start(), shared))
        return out

    def shared_call_counts(self, jf, off):
        names = self.shared_names.get(jf.rel, {"*"})
        if "*" in names or "default" in names:
            return True
        fn = jf.enclosing(off)
        if fn is None:
            return True
        # reachable: some imported name leads to the function holding the call
        reach, todo = set(), [n for n in names]
        while todo:
            n = todo.pop()
            if n in reach:
                continue
            reach.add(n)
            for f in jf.funcs:
                if f[0] == n:
                    body = jf.text[f[2]:f[3]]
                    for g in jf.funcs:
                        if g[0] != n and re.search(r"\b%s\s*\(" % re.escape(g[0]), body):
                            todo.append(g[0])
        names_here = {f[0] for f in jf.funcs if f[2] <= fn[2] and f[3] >= fn[3]}
        return bool(reach & names_here)

    def helper_ops(self, jf, fn, cls_param, arg, off, shared):
        name, params = fn[0], fn[1]
        out = []
        sites = []
        pat = re.compile(r"(?<![\w$])(?:[\w$]+\.)?%s\s*\(" % re.escape(name))
        for rel in self.order:
            f2 = self.files[rel]
            for mm in pat.finditer(f2.text):
                pre = f2.text[max(0, mm.start() - 20):mm.start()]
                if re.search(r"function\s*\*?\s*$", pre) or (rel == jf.rel and f2.enclosing(mm.start()) is fn and False):
                    continue
                oi = mm.end() - 1
                ci = scan_balanced(f2.text, oi)
                if ci < 0:
                    continue
                if rel == jf.rel and fn[2] < mm.start() < fn[3] and f2.enclosing(mm.start()) is fn:
                    continue
                if not self.is_counted(f2, mm.start()):
                    continue
                sites.append((f2, mm.start(), split_top(f2.text[oi + 1:ci])))
        if not sites:
            return [Op(None, None, None, "helper %s is not called in this function's code" % name, "%s:%d" % (jf.rel, jf.line(off)), note="could not judge")]
        for f2, soff, args in sites:
            binding = {}
            for idx, p in enumerate(params):
                if p is None:
                    continue
                if idx < len(args):
                    v = self.value(f2, args[idx], soff, None, 1)
                    if v[0] == "param":
                        v = ("unk", "name passed through more than one helper")
                    binding[p] = v
            pkgcmd = binding.get(cls_param)
            if not pkgcmd or pkgcmd[0] != "cls":
                if pkgcmd and pkgcmd[0] == "unk" and "more than one helper" in pkgcmd[1]:
                    out.append(Op(None, None, None, "command passed through more than one helper (%s)" % name, "%s:%d" % (jf.rel, jf.line(off)), note="could not judge"))
                continue
            # object-valued parameters are read through obj_props at the call site
            for idx, p in enumerate(params):
                if p and idx < len(args) and args[idx].strip().startswith("{"):
                    props, _ = self.obj_props(f2, args[idx], soff, None)
                    binding[p] = ("obj", props)
            out.extend(self.make_ops(jf, pkgcmd[1], pkgcmd[2], arg, off, binding, shared))
        return out

    def call_sites(self, def_jf, fn):
        """Reached places that call function fn of def_jf: ([(file, offset, args)], unreadable)."""
        fname = fn[0]
        sites, odd = [], False
        for rel in self.order:
            f2 = self.files[rel]
            local, nss = set(), set()
            if rel == def_jf.rel:
                local.add(fname)
            for (_a, _b, spec, kind, d) in f2.import_records():
                tgt = self.resolve_spec(rel, spec) if spec.startswith(".") else None
                if tgt != def_jf.rel:
                    continue
                if kind == "named":
                    for lname, imp in d.items():
                        if def_jf.export_alias.get(imp, imp) == fname:
                            local.add(lname)
                elif kind == "ns":
                    nss.add(d)
                else:
                    odd = True
            if not local and not nss:
                continue
            spans = [(a, b) for (a, b, _s, k, _d) in f2.import_records() if k != "all"] + list(f2.export_spans)
            for mm in re.finditer(r"(?<![\w$.])(?:([\w$]+)\s*\.\s*)?([\w$]+)\b(\s*\()?", f2.text):
                nsn, nm = mm.group(1), mm.group(2)
                hit = (nsn is None and nm in local) or (nsn in nss and nm == fname)
                if not hit:
                    continue
                st = mm.start(2) if nsn is None else mm.start(1)
                if st in f2.decl_offsets or any(a <= st < b for a, b in spans):
                    continue
                if rel == def_jf.rel and fn[2] < st < fn[3]:
                    continue
                if not self.is_counted(f2, st):
                    continue
                if not mm.group(3):
                    odd = True
                    continue
                oi = mm.end() - 1
                ci = scan_balanced(f2.text, oi)
                if ci < 0:
                    odd = True
                    continue
                sites.append((f2, st, split_top(f2.text[oi + 1:ci])))
        return sites, odd

    def make_ops(self, jf, pkg, cmd, arg, off, binding, shared, expand=True):
        sa = sdk_action(pkg, cmd)
        where = "%s:%d" % (jf.rel, jf.line(off))
        if sa is None:
            return []
        efn = jf.enclosing(off)
        codefn = efn[0] if efn else "-"
        if expand and binding is None:
            props0, _w0 = self.obj_props(jf, arg, off, None)
            handed = {}
            for pn in ("TableName", "Bucket", "QueueUrl", "SecretId", "IndexName", "Key", "Namespace"):
                if pn in props0:
                    v0 = self.value(jf, props0[pn][0], props0[pn][1] if props0[pn][1] else off, None)
                    if v0[0] == "param":
                        handed[v0[1]] = v0
            if handed:
                fn = next(iter(handed.values()))[2]
                sites, odd = self.call_sites(jf, fn)
                why = None
                if odd or not sites:
                    why = "name handed in by the caller; not every place that calls %s can be read" % fn[0]
                bindings = []
                for f2, soff, args in sites if not why else []:
                    b = {}
                    for pname in handed:
                        idx = fn[1].index(pname) if pname in fn[1] else -1
                        sv = self.value(f2, args[idx], soff, None, 1) if 0 <= idx < len(args) else ("unk", "argument missing")
                        if sv[0] != "lit":
                            why = "name handed in by the caller in %s (%s) is not readable" % (f2.rel, (f2.enclosing(soff) or ("-",))[0])
                            break
                        b[pname] = sv
                    if why:
                        break
                    bindings.append((b, "%s:%d" % (f2.rel, f2.line(soff))))
                act = S3_AS.get(sa[0], [sa[0]])[0].split("@")[0]
                if why:
                    return [Op(act, sa[1], None, why, where, note="could not judge", codefn=codefn)]
                out = []
                for b, at in bindings:
                    for op in self.make_ops(jf, pkg, cmd, arg, off, b, shared, expand=False):
                        if op.note != "could not judge" and not op.note.startswith("could not judge:"):
                            op.note = (op.note + "; " if op.note else "") + "name from the caller at " + at
                        out.append(op)
                return out
        ops = self.make_ops_inner(jf, pkg, cmd, arg, off, binding, shared, sa, where)
        for op in ops:
            op.codefn = codefn
        return ops

    def make_ops_inner(self, jf, pkg, cmd, arg, off, binding, shared, sa, where):
        action, svc = sa
        pfx = action.split(":")[0]
        props, why = self.obj_props(jf, arg, off, binding)
        note = "from a shared file" if shared else ""

        def prop(*names):
            for n in names:
                if n in props:
                    return self.value(jf, props[n][0], props[n][1] if props[n][1] else off, binding)
            return None

        if action in ("dynamodb:TransactWriteItems", "dynamodb:TransactGetItems"):
            ops = []
            kinds = {"Put": "PutItem", "Update": "UpdateItem", "Delete": "DeleteItem", "ConditionCheck": "ConditionCheckItem", "Get": "GetItem"}
            for mm in re.finditer(r"\b(Put|Update|Delete|ConditionCheck|Get)\s*:\s*\{", arg):
                cl = scan_balanced(arg, mm.end() - 1)
                inner_props, _ = self.obj_props(jf, arg[mm.end() - 1:cl + 1], off, binding)
                v = self.value(jf, inner_props["TableName"][0], off, binding) if "TableName" in inner_props else ("unk", "name not readable")
                ops.append(self.table_op("dynamodb:" + kinds[mm.group(1)], svc, v, None, where, note))
            return ops or [Op(action, svc, None, "name not readable (%s)" % (why or "transaction items"), where, note="could not judge")]
        if pfx == "dynamodb":
            if action in ("dynamodb:BatchGetItem", "dynamodb:BatchWriteItem"):
                m = re.search(r"RequestItems\s*:\s*\{([^}]*)", arg)
                tables = []
                if m:
                    for ent in split_top(m.group(1)):
                        mm = re.match(r"\s*(?:(['\"])([^'\"]+)\1|\[\s*([\w$.]+)\s*\]|([\w$]+))\s*:", ent)
                        if mm:
                            if mm.group(2):
                                tables.append(("lit", mm.group(2)))
                            else:
                                tables.append(self.value(jf, mm.group(3) or mm.group(4), off, binding))
                if not tables:
                    return [Op(action, svc, None, "name not readable (RequestItems)", where, note="could not judge")]
                return [self.table_op(action, svc, v, None, where, note) for v in tables]
            v = prop("TableName") or ("unk", why or "name not readable")
            idx = prop("IndexName")
            return [self.table_op(action, svc, v, idx, where, note)]
        if pfx == "s3":
            b = prop("Bucket") or ("unk", why or "bucket not readable")
            k = prop("Key")
            out = []
            for act in S3_AS.get(action, [action]):
                if act.endswith("@source"):
                    act = act.split("@")[0]
                    src = prop("CopySource")
                    if src and src[0] == "lit" and "/" in src[1].lstrip("/"):
                        sb, sk = src[1].lstrip("/").split("/", 1)
                        out.append(Op(act, svc, {"kind": "bucket", "name": sb, "key": sk}, None, where, note=note))
                    else:
                        out.append(Op(act, svc, None, "copy source not readable", where, note="could not judge"))
                    continue
                if b[0] != "lit":
                    out.append(Op(act, svc, None, b[1] if b[0] == "unk" else "bucket not readable", where, note="could not judge"))
                    continue
                key = k[1] if k and k[0] == "lit" and act != "s3:ListBucket" else None
                out.append(Op(act, svc, {"kind": "bucket", "name": b[1], "key": key}, None, where, note=note))
            return out
        if action == "cloudwatch:PutMetricData":
            nsv = prop("Namespace")
            return [Op(action, svc, None, None, where, params={"cloudwatch:namespace": nsv[1] if nsv and nsv[0] == "lit" else None}, note=note)]
        if pfx == "sqs":
            q = prop("QueueUrl")
            if q is None:
                return [Op(action, svc, None, None, where, note=note)]
            if q[0] == "lit":
                return [Op(action, svc, {"kind": "queue", "name": q[1].rstrip("/").rsplit("/", 1)[-1]}, None, where, note=note)]
            return [Op(action, svc, None, q[1] if q[0] == "unk" else "queue not readable", where, note="could not judge: key not checked for sqs")]
        if pfx == "secretsmanager" and action == "secretsmanager:GetSecretValue":
            sidv = prop("SecretId")
            if sidv and sidv[0] == "lit":
                nm = sidv[1].split(":secret:")[-1]
                return [Op(action, svc, {"kind": "secret", "name": nm}, None, where, note=note)]
            return [Op(action, svc, None, (sidv[1] if sidv and sidv[0] == "unk" else "secret not readable"), where, note="could not judge: key not checked for secretsmanager")]
        if pfx == "kms":
            kid = prop("KeyId")
            return [Op(action, svc, {"kind": "kms", "name": kid[1] if kid and kid[0] == "lit" else None}, None if kid and kid[0] == "lit" else "key not readable", where, note=note)]
        return [Op(action, svc, None, None, where, note=note)]

    def table_op(self, action, svc, v, idx, where, note):
        if v[0] != "lit":
            why = v[1] if v[0] == "unk" else "name not readable"
            return Op(action, svc, None, why, where, note="could not judge")
        index = None
        if idx is not None:
            if idx[0] != "lit":
                return Op(action, svc, {"kind": "table", "name": v[1], "index": "?"}, "index name not readable", where, note=note)
            index = idx[1]
        return Op(action, svc, {"kind": "table", "name": v[1], "index": index}, None, where, note=note)


# ----------------------------------------------------------------------------
# Workflow definitions
# ----------------------------------------------------------------------------
def walk_states(defn, out):
    if not isinstance(defn, dict):
        return
    for sname, st in (defn.get("States") or {}).items():
        if not isinstance(st, dict):
            continue
        if st.get("Type") == "Task":
            out.append((sname, st))
        for br in st.get("Branches", []) or []:
            walk_states(br, out)
        for key in ("Iterator", "ItemProcessor"):
            if isinstance(st.get(key), dict):
                walk_states(st[key], out)


def workflow_ops(world, wf):
    d = wf["definition"]
    if isinstance(d, TemplateText):
        text = re.sub(r"\$\{[^}]*\}", "UNREADABLE-TEMPLATE-VALUE", str(d))
        try:
            d = json.loads(text)
        except ValueError:
            return None, "definition (template) not readable"
    elif isinstance(d, str):
        try:
            d = json.loads(d)
        except ValueError:
            return None, "definition not readable"
    elif unk(d) or not isinstance(d, dict):
        return None, "definition not readable"
    tasks = []
    walk_states(d, tasks)
    ops = []
    for sname, st in tasks:
        res = st.get("Resource", "")
        params = st.get("Parameters") or {}
        where = "%s state %s" % (wf["where"], sname)
        if not isinstance(res, str) or "UNREADABLE-TEMPLATE-VALUE" in res:
            ops.append(Op(None, None, None, "resource of the state not readable", where, note="could not judge"))
            continue
        m = re.match(r"arn:aws:states:::aws-sdk:([\w-]+):(\w+)(?:\.\w+)?$", res)
        if m:
            svc, op = m.group(1), m.group(2)
            action = "%s:%s" % (SDK_SERVICE_PREFIX.get(svc, svc), op[0].upper() + op[1:])
        else:
            m = re.match(r"arn:aws:states:::(dynamodb|lambda|events|sqs|states|sns):(\w+)(?:\.\w+)?$", res)
            if m:
                short = {"lambda:invoke": "lambda:InvokeFunction", "events:putEvents": "events:PutEvents",
                         "sqs:sendMessage": "sqs:SendMessage", "states:startExecution": "states:StartExecution",
                         "sns:publish": "sns:Publish"}
                key = "%s:%s" % (m.group(1), m.group(2))
                action = short.get(key) or ("dynamodb:%s%s" % (m.group(2)[0].upper(), m.group(2)[1:]) if m.group(1) == "dynamodb" else None)
            elif res.startswith("arn:aws:lambda:"):
                action = "lambda:InvokeFunction"
            else:
                action = None
        if not action:
            ops.append(Op(None, None, None, "unknown task type", where, note="could not judge"))
            continue
        resource, why = None, None
        if action.startswith("dynamodb:"):
            tn = params.get("TableName")
            if isinstance(tn, str) and "UNREADABLE" not in tn:
                resource = {"kind": "table", "name": tn, "index": params.get("IndexName") if isinstance(params.get("IndexName"), str) else None}
            else:
                why = "name not readable (TableName)"
        ops.append(Op(action, action.split(":")[0], resource, why, where, note="could not judge" if why else ""))
    return ops, None


# ----------------------------------------------------------------------------
# Judging and reporting
# ----------------------------------------------------------------------------
class Finding:
    def __init__(self, kind, subject, action, resource, where, detail="", codefn=""):
        self.codefn = codefn or "-"
        self.new = False
        self.kind = kind
        self.subject = subject
        self.action = action
        self.resource = resource
        self.where = where
        self.detail = detail

    @property
    def key(self):
        return (self.subject, self.action or "", self.resource or "", self.kind)

    @property
    def file(self):
        m = re.match(r"(.*?):\d+$", self.where or "")
        return m.group(1) if m else (self.where or "")

    @property
    def cnj_key(self):
        """Who a could-not-judge line is: function, action, file, code function and reason (spec 4b item 10)."""
        return (self.subject, self.action or "", self.file, self.codefn, self.detail)

    def line(self):
        head = {"missing": "MISSING", "key missing": "KEY MISSING", "could not judge": "could not judge", "warning": "warning",
                "accepted": "accepted"}[self.kind]
        return "%-15s %s  %s  %s  %s  (%s)" % (head, self.subject, self.action or "-", self.resource or "-", self.detail, self.where)


class Result:
    def __init__(self):
        self.findings = []
        self.functions = 0
        self.workflows = 0
        self.calls = 0
        self.allowed = 0
        self.skipped = []
        self.notes = []
        self.unreached = []
        self.new_cnj = None

    def count(self, kind):
        return sum(1 for f in self.findings if f.kind == kind)


def display(res):
    if not res:
        return ""
    if res["kind"] == "table":
        s = "table/%s" % res["name"]
        if res.get("index"):
            s += "/index/%s" % res["index"]
        return s
    if res["kind"] == "bucket":
        return "bucket/%s" % res["name"] + ("/" + res["key"] if res.get("key") else "")
    return "%s/%s" % (res["kind"], res.get("name") or "?")


def key_needs(op, locked):
    """(list of kms actions, via service, context) the call needs on the key of `locked`."""
    a = op.action
    if op.resource["kind"] == "table":
        return ["Decrypt"], "dynamodb", None
    if op.resource["kind"] == "bucket":
        ctx = {"aws:s3:arn": "arn:aws:s3:::%s" % op.resource["name"]}
        if a in ("s3:PutObject", "s3:CreateMultipartUpload", "s3:UploadPart"):
            return ["GenerateDataKey"], "s3", ctx
        if a in ("s3:GetObject", "s3:HeadObject"):
            return ["Decrypt"], "s3", ctx
        return [], None, None
    if op.resource["kind"] == "queue":
        if a == "sqs:SendMessage":
            return ["GenerateDataKey", "Decrypt"], "sqs", None
        if a == "sqs:ReceiveMessage":
            return ["Decrypt"], "sqs", None
        return [], None, None
    if op.resource["kind"] == "secret":
        return ["Decrypt"], "secretsmanager", None
    return [], None, None


def judge_ops(world, subject, role, ops, result, extra_where=""):
    n0 = len(result.findings)
    _judge_ops(world, subject, role, ops, result, extra_where)
    return n0


def _judge_ops(world, subject, role, ops, result, extra_where=""):
    for op in ops:
        n_before = len(result.findings)
        _judge_one(world, subject, role, op, result)
        for f in result.findings[n_before:]:
            f.codefn = op.codefn or "-"


def _judge_one(world, subject, role, op, result):
    for op in [op]:
        result.calls += 1
        if op.action is None or op.res_why and op.resource is None:
            result.findings.append(Finding("could not judge", subject, op.action, "", op.where, op.res_why or "not readable"))
            continue
        if role is None:
            result.findings.append(Finding("could not judge", subject, op.action, display(op.resource), op.where, "role not readable"))
            continue
        res = op.resource
        arn, locked, kind_missing = None, None, False
        verdicts = []
        # which resource does the call land on
        if res and res["kind"] in ("table", "bucket", "queue", "secret"):
            locked = world.find(res["kind"], res["name"])
            if locked is None:
                result.findings.append(Finding("could not judge", subject, op.action, display(res), op.where, "no such %s in the setup files" % res["kind"]))
                continue
            region, acct = world.ctxs[0].region, world.ctxs[0].acct
            if res["kind"] == "table":
                arn = "arn:aws:dynamodb:%s:%s:table/%s" % (region, acct, res["name"])
                if res.get("index") and res["index"] != "?":
                    arn += "/index/" + res["index"]
                elif res.get("index") == "?":
                    arn = ("any", arn)
                # IAM wildcard in region/account: matched with * in the pattern
            elif res["kind"] == "bucket":
                base = "arn:aws:s3:::%s" % res["name"]
                if op.action in ("s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:HeadObject", "s3:CreateMultipartUpload", "s3:UploadPart"):
                    arn = base + "/" + res["key"] if res.get("key") else ("s3key", base)
                else:
                    arn = base
            elif res["kind"] == "queue":
                arn = "arn:aws:sqs:%s:%s:%s" % (region, acct, res["name"])
            else:
                arn = ("secret", "arn:aws:secretsmanager:%s:%s:secret:%s" % (region, acct, res["name"]))
        if res and res["kind"] == "kms":
            tok, why = (None, "key not readable") if not res.get("name") else key_token_of(res["name"], world)
            if tok is None:
                result.findings.append(Finding("could not judge", subject, op.action, "", op.where, why or "key not readable"))
                continue
            kr = world.key_allows(role, tok, op.action.split(":", 1)[1], None, None)
            if kr == "missing":
                result.findings.append(Finding("key missing", subject, op.action, "key/%s" % tok, op.where, "neither the key policy nor the role allows this"))
            elif isinstance(kr, tuple):
                result.findings.append(Finding("could not judge", subject, op.action, "key/%s" % tok, op.where, kr[1]))
            else:
                result.allowed += 1
            continue
        r1 = role_allows_wild(world, role, op.action, arn, op.params)
        if r1 == "missing":
            result.findings.append(Finding("missing", subject, op.action, display(res), op.where, "the role has no right for this call" + ((" (" + op.note + ")") if op.note else "")))
        elif isinstance(r1, tuple):
            result.findings.append(Finding("could not judge", subject, op.action, display(res), op.where, r1[1]))
        # the key
        if locked is not None and locked.key is not None:
            needs, via, context = key_needs(op, locked)
            if locked.key == "?":
                result.findings.append(Finding("could not judge", subject, op.action, display(res), op.where, "the key of the %s is %s" % (locked.kind, locked.key_note or "not readable")))
            else:
                worst = None
                for need in needs:
                    kr = world.key_allows(role, locked.key, need, via, context)
                    if kr == "missing":
                        worst = ("missing", need)
                        break
                    if isinstance(kr, tuple) and worst is None:
                        worst = ("cnj", kr[1])
                if worst and worst[0] == "missing":
                    result.findings.append(Finding("key missing", subject, op.action, display(res), op.where,
                                                   "key %s: the role may not use kms:%s%s" % (locked.key, worst[1], " through " + via if via else "")))
                elif worst:
                    result.findings.append(Finding("could not judge", subject, op.action, display(res), op.where, "key %s: %s" % (locked.key, worst[1])))
                elif r1 == "allowed":
                    result.allowed += 1
        elif r1 == "allowed":
            result.allowed += 1
        if op.action in MODEL_ACTIONS and role is not None:
            have = [world.role_allows(role, m, None) == "allowed" for m in MARKETPLACE]
            if not all(have):
                result.findings.append(Finding("warning", subject, op.action, "", op.where,
                                               "could not judge: depends on the account's model subscription; the role lacks aws-marketplace:ViewSubscriptions and Subscribe"))
        if op.note.startswith("could not judge: key not checked"):
            result.findings.append(Finding("could not judge", subject, op.action, "", op.where, op.note.split(": ", 1)[1]))


def role_allows_wild(world, role, action, arn, ctx=None):
    if arn is None:
        return world.role_allows(role, action, None, ctx)
    if isinstance(arn, tuple) and arn[0] == "secret":
        # Secrets Manager accepts the ARN with or without the six-letter suffix
        r = world.role_allows(role, action, arn[1])
        return r if r != "missing" else world.role_allows(role, action, arn[1] + "-AbCdEf")
    if isinstance(arn, tuple) and arn[0] == "any":
        base = arn[1]
        # an index name that could not be read: any statement naming the table or its indexes counts as unreadable
        r = world.role_allows(role, action, base)
        return r if r != "allowed" else ("cnj", "index name not readable")
    if isinstance(arn, tuple) and arn[0] == "s3key":
        return world.role_allows(role, action, ("s3", arn[1]))
    return world.role_allows(role, action, arn)


def function_files(tree, name, lam, external):
    folder = external.get(name, "lambda/%s" % name)
    handler = lam.get("handler") or "index.handler"
    base = handler.rsplit(".", 1)[0]
    for e in EXTS:
        rel = "%s/%s%s" % (folder, base, e)
        if tree.exists(rel):
            files = [rel]
            # other plain code files of the folder are read too (not tests)
            for f in tree.files(folder):
                if f.endswith(EXTS) and f != rel and not re.search(r"(\.test\.|\.spec\.)", f) and f.count("/") == folder.count("/") + 1:
                    files.append(f)
            return files
    return None


def external_functions(tree):
    if not tree.exists("scripts/ci/build-lambdas.py"):
        return {}
    text = tree.read("scripts/ci/build-lambdas.py")
    m = re.search(r"EXTERNAL\s*=\s*\{(.*?)\}", text, re.S)
    out = {}
    if m:
        for mm in re.finditer(r"""["'](\w+)["']\s*:\s*ROOT\s*/\s*["']([^"']+)["']""", m.group(1)):
            out[mm.group(1)] = mm.group(2)
    return out


def analyze(root, known_keys=None):
    tree = Tree(root)
    world = World(tree, known_keys)
    result = Result()
    result.notes.extend(world.notes)
    external = external_functions(tree)
    code_dirs = sorted(set(tree.dirs("lambda")) | set(external))
    code_dirs = [d for d in code_dirs if d != "shared" and (tree.files("lambda/%s" % d) or d in external)]
    for name, lam in sorted(world.lambdas.items()):
        files = function_files(tree, name, lam, external)
        where = lam["where"]
        if files is None:
            if name in code_dirs or name in external or tree.files("lambda/%s" % name):
                result.findings.append(Finding("could not judge", name, None, "", where, "code not found for handler %s" % lam.get("handler")))
            else:
                result.skipped.append(name)
            continue
        role = world.roles.get(lam["role"]) if lam["role"] else None
        fc = FunctionCode(tree, name, "lambda/%s" % name, files, lam["env"], lam["env_ok"])
        result.functions += 1
        for msg, rel, line in fc.notes:
            result.findings.append(Finding("could not judge", name, None, "", "%s:%d" % (rel, line), msg.split(": ", 1)[1]))
        if role is None:
            result.findings.append(Finding("could not judge", name, None, "", where, "role not readable"))
            continue
        ops = fc.ops()
        judge_ops(world, name, role, ops, result)
        for action, where_, codefn in fc.unreached:
            row = (name, action, where_, codefn)
            if row not in result.unreached:
                result.unreached.append(row)
    for name in code_dirs:
        if name not in world.lambdas:
            result.skipped.append(name)
    for wf in world.workflows:
        role = world.roles.get(wf["role"]) if wf["role"] else None
        ops, why = workflow_ops(world, wf)
        result.workflows += 1
        if ops is None:
            result.findings.append(Finding("could not judge", wf["name"], None, "", wf["where"], why))
            continue
        judge_ops(world, "workflow " + wf["name"], role, ops, result)
    # one line per finding (a function can hit the same call in several files)
    seen, uniq = set(), []
    for f in result.findings:
        k = (f.key, f.where, f.detail)
        if k in seen:
            continue
        seen.add(k)
        uniq.append(f)
    result.findings = uniq
    return result


# ----------------------------------------------------------------------------
# Exceptions
# ----------------------------------------------------------------------------
class Exceptions:
    def __init__(self, text=""):
        self.known_keys = {}
        self.entries = []
        self.reviewed = []
        self.errors = []
        sec = None
        for n, raw in enumerate(text.splitlines(), 1):
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            m = re.match(r"\[(.+)\]$", line)
            if m:
                sec = m.group(1)
                continue
            parts = [p.strip() for p in line.split("|")]
            if sec == "known keys":
                if len(parts) < 4 or not parts[2] or not parts[3]:
                    self.errors.append("exception without a reason (known keys, line %d)" % n)
                    continue
                tok = re.sub(r"^.*?\s(aws_kms_key\.\S+|module\.\S+)$", r"\1", parts[1])
                self.known_keys[parts[0]] = tok
            elif sec == "exceptions":
                if len(parts) < 6 or not parts[3] or not parts[5]:
                    self.errors.append("exception without a reason (line %d)" % n)
                    continue
                self.entries.append({"subject": parts[0], "action": parts[1], "resource": parts[2], "reason": parts[3],
                                     "fix": parts[4], "date": parts[5], "line": n, "used": False})
            elif sec == "cannot be judged":
                # function | action | file | code function | how many | why | who checked and what they found | date
                if len(parts) < 8 or not all(parts[i] for i in (0, 1, 2, 3, 5, 6, 7)) or not parts[4].isdigit() or int(parts[4]) < 1:
                    self.errors.append("reviewed line without its function, file, code function, count, reason, checker or date (line %d)" % n)
                    continue
                self.reviewed.append({"subject": parts[0], "action": parts[1], "file": parts[2], "codefn": parts[3], "count": int(parts[4]),
                                      "reason": parts[5], "checked": parts[6], "date": parts[7], "line": n, "used": 0, "on_blocking": False})

    def apply_reviewed(self, findings):
        for e in self.reviewed:
            ident = (e["subject"], e["action"], e["file"], e["codefn"])
            for f in findings:
                if (f.subject, f.action or "", f.file, f.codefn) != ident:
                    continue
                if f.kind in BLOCKING:
                    if not e["on_blocking"]:
                        e["on_blocking"] = True
                        self.errors.append("a [cannot be judged] line matches a %s finding: %s | %s | %s | %s (line %d)"
                                           % (f.kind.upper(), e["subject"], e["action"], e["file"], e["codefn"], e["line"]))
                    continue
                if f.kind == "could not judge" and e["used"] < e["count"]:
                    e["used"] += 1
                    f.kind = "accepted"
                    f.detail = "%s (reviewed: %s)" % (e["reason"], e["checked"])

    def apply(self, findings):
        for f in findings:
            if f.kind not in BLOCKING:
                continue
            for e in self.entries:
                if (e["subject"], e["action"], e["resource"]) == (f.subject, f.action, f.resource):
                    e["used"] = True
                    f.kind = "accepted"
                    f.detail = e["reason"]
                    break


# ----------------------------------------------------------------------------
# Running, reporting, exit codes
# ----------------------------------------------------------------------------
def base_tree(root, ref):
    tmp = tempfile.mkdtemp(prefix="permcheck-base-")
    ls = subprocess.run(["git", "-C", str(root), "ls-tree", "--name-only", ref], capture_output=True)
    if ls.returncode != 0:
        raise RuntimeError("cannot read %s: %s" % (ref, ls.stderr.decode("utf-8", "replace").strip()[:200]))
    top = set(ls.stdout.decode("utf-8", "replace").split())
    paths = [x for x in ("infra", "talent-flow-infra", "lambda", "mcp") if x in top]
    paths.append("scripts/ci/build-lambdas.py")
    p = subprocess.run(["git", "-C", str(root), "archive", ref] + paths, capture_output=True)
    if p.returncode != 0:
        p = subprocess.run(["git", "-C", str(root), "archive", ref] + paths[:-1], capture_output=True)
        if p.returncode != 0:
            raise RuntimeError("cannot read %s: %s" % (ref, p.stderr.decode("utf-8", "replace").strip()[:200]))
    # unpacked with the standard library: git is the only program this script runs
    try:
        with tarfile.open(fileobj=io.BytesIO(p.stdout)) as tf:
            base = os.path.realpath(tmp)
            for member in tf.getmembers():
                dest = os.path.realpath(os.path.join(tmp, member.name))
                if not (dest == base or dest.startswith(base + os.sep)) or not (member.isfile() or member.isdir()):
                    continue
                if hasattr(tarfile, "data_filter"):
                    tf.extract(member, tmp, filter="data")
                else:
                    tf.extract(member, tmp)
    except (tarfile.TarError, OSError):
        raise RuntimeError("cannot unpack %s" % ref)
    return tmp


def render(result, exc, base_keys, blocking, mode_note):
    out = []
    order = ["missing", "key missing", "warning", "could not judge", "accepted"]
    for kind in order:
        rows = [f for f in result.findings if f.kind == kind]
        if not rows:
            continue
        out.append("## %s (%d)" % (kind, len(rows)))
        for f in rows:
            tag = " [already on the base branch]" if f.kind in BLOCKING and base_keys is not None and f.key in base_keys else ""
            if f.kind == "could not judge" and f.new:
                tag = " [new on this change]"
            out.append(f.line() + tag)
        out.append("")
    if result.unreached:
        out.append("not reached, not judged:")
        for subj, action, where, codefn in result.unreached:
            out.append("  %s  %s  in %s  (%s)" % (subj, action, codefn, where))
        out.append("")
    import datetime
    today = datetime.date.today()
    for e in exc.entries:
        try:
            age = (today - datetime.date.fromisoformat(e["date"])).days
        except ValueError:
            continue
        if age > 14 and not e["fix"].lower().startswith("never"):
            out.append("stale known gap (%d days, fix: %s): %s | %s | %s" % (age, e["fix"], e["subject"], e["action"], e["resource"]))
    for e in exc.reviewed:
        if not e["used"] and not e["on_blocking"]:
            out.append("stale reviewed line (no such call any more): %s | %s | %s | %s (line %d)" % (e["subject"], e["action"], e["file"], e["codefn"], e["line"]))
    stale = [e for e in exc.entries if not e["used"]]
    for e in stale:
        out.append("stale exception (no such finding any more): %s | %s | %s (line %d)" % (e["subject"], e["action"], e["resource"], e["line"]))
    for msg in exc.errors:
        out.append("ERROR %s" % msg)
    if result.notes:
        out.append("notes:")
        out.extend("  " + n for n in result.notes[:20])
    out.append("Not deployed, skipped: %d folders" % len(result.skipped))
    out.append(mode_note)
    out.append("functions read: %d, workflows read: %d, calls found: %d, allowed: %d, missing: %d, key missing: %d, could not judge: %d, warnings: %d, accepted: %d, new could not judge: %d"
               % (result.functions, result.workflows, result.calls, result.allowed, result.count("missing"), result.count("key missing"),
                  result.count("could not judge"), result.count("warning"), result.count("accepted"), len(result.new_cnj or [])))
    out.append("Judged on the dev setup. For services other than DynamoDB, S3, KMS, SQS and Secrets Manager only the action is judged.")
    if blocking:
        out.append("Findings new on this change: %d" % len(blocking))
    return "\n".join(out)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=str(Path(__file__).resolve().parents[2]))
    ap.add_argument("--mode", choices=("report", "enforce"), default=MODE_DEFAULT)
    ap.add_argument("--base-ref", default="")
    ap.add_argument("--exceptions", default="")
    ap.add_argument("--summary", default=os.environ.get("GITHUB_STEP_SUMMARY", ""))
    args = ap.parse_args(argv)
    effective = "enforce" if args.mode == "enforce" and args.base_ref else "report"
    try:
        exc_text = ""
        if args.base_ref:
            # the reviewed and exceptions lists always come from the target branch, never from the change
            g = subprocess.run(["git", "-C", str(args.root), "show", "%s:scripts/ci/permission-check-exceptions.txt" % args.base_ref], capture_output=True)
            exc_text = g.stdout.decode("utf-8", "replace") if g.returncode == 0 else ""
        else:
            ex_path = Path(args.exceptions) if args.exceptions else Path(args.root) / "scripts/ci/permission-check-exceptions.txt"
            if ex_path.is_file():
                exc_text = ex_path.read_text(encoding="utf-8")
        exc = Exceptions(exc_text)
        result = analyze(args.root, exc.known_keys)
        exc.apply(result.findings)
        exc.apply_reviewed(result.findings)
        base_keys = None
        notes = ["Mode: %s." % effective]
        if args.mode == "enforce" and not args.base_ref:
            notes.append("No base branch on this run (push or by-hand run): report mode, nothing is blocked.")
        if args.base_ref:
            btmp = base_tree(args.root, args.base_ref)
            base_result = analyze(btmp, exc.known_keys)
            bexc = Exceptions(exc_text)
            bexc.apply(base_result.findings)
            bexc.apply_reviewed(base_result.findings)
            base_keys = {f.key for f in base_result.findings if f.kind in BLOCKING}
            if Path(args.root, "scripts/ci/permission-check-exceptions.txt").is_file():
                mine = Path(args.root, "scripts/ci/permission-check-exceptions.txt").read_text(encoding="utf-8")
                if mine != exc_text:
                    notes.append("Note: this change edits the exceptions file; the base branch's copy was used.")
            from collections import Counter
            have = Counter(f.cnj_key for f in base_result.findings if f.kind == "could not judge")
            result.new_cnj = []
            for f in result.findings:
                if f.kind != "could not judge":
                    continue
                if have[f.cnj_key] > 0:
                    have[f.cnj_key] -= 1
                else:
                    f.new = True
                    result.new_cnj.append(f)
        blocking = [f for f in result.findings if f.kind in BLOCKING and (base_keys is None or f.key not in base_keys)]
        blocking += list(result.new_cnj or [])
        text = render(result, exc, base_keys, blocking if effective == "enforce" else [], " ".join(notes))
        print(text)
        if args.summary:
            try:
                with open(args.summary, "a", encoding="utf-8") as fh:
                    fh.write("### Permission check (%s mode)\n\n```\n%s\n```\n" % (effective, text))
            except OSError:
                pass
        if effective == "enforce" and (blocking or exc.errors):
            return 1
        return 0
    except Exception as ex:  # a broken check must never be a silent pass in enforce mode
        msg = "permission check could not run: %s: %s" % (type(ex).__name__, ex)
        if os.environ.get("PERMCHECK_DEBUG"):
            import traceback
            traceback.print_exc()
        print(msg)
        if args.summary:
            try:
                with open(args.summary, "a", encoding="utf-8") as fh:
                    fh.write("### Permission check\n\n**%s**\n" % msg)
            except OSError:
                pass
        return 2 if effective == "enforce" else 0


if __name__ == "__main__":
    sys.exit(main())
