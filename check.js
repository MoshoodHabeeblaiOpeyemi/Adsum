// Adsum — syntax validator
//
// WHY THIS EXISTS
// ---------------
// `node --check app.js` reports SUCCESS on a file that does not parse.
//
// app.js is an ES module (it has `import` statements at the top). `node --check`
// parses its target as CommonJS, throws on the first `import`, and STOPS —
// reporting failure-to-parse as... nothing at all. It never reaches the body, so
// a syntax error on line 8000 is invisible. That is not a theoretical risk: a
// stray comma in a ternary in `saveChosenRep()` shipped through several rounds
// of "syntax: clean" because of exactly this blind spot.
//
// So this script does it properly:
//   - parses browser files with `vm.SourceTextModule` (ES module semantics)
//   - parses `api/*.js` and `utils/*.js` with `node --check` (they ARE CommonJS)
//   - extracts and parses EVERY top-level function on its own, so a broken one
//     is named with its line number instead of hiding behind an unrelated error
//   - proves itself first, by planting a known error and requiring that it is
//     caught — a validator that cannot fail is worse than no validator
//   - checks index.html for duplicate ids, because getElementById resolves to
//     the FIRST match in document order and a collided id silently strands one
//     element forever, with no error anywhere
//   - rejects MOJIBAKE, which is the failure a plain "does it parse" check
//     waves through. See section 6 for why that one nearly shipped.
//
// Run: npm run check

const fs = require("fs");
const vm = require("vm");
const { execFileSync } = require("child_process");

let fails = 0;
const ok = (l) => console.log("PASS  " + l);
const bad = (l, d) => { fails++; console.log("FAIL  " + l + (d ? "\n        " + d : "")); };

// --- 1. Prove the old method is blind, and the new one is not ----------
const app = fs.readFileSync("app.js", "utf8");
const isModule = /^\s*import\s/m.test(app);

try {
  new vm.Script(app, { filename: "app.js" });
  console.log("note: app.js parses as a script (not a module)");
} catch (e) {
  if (/import statement outside a module/.test(e.message)) {
    ok("confirmed: app.js is an ES module; `node --check` cannot validate it");
  } else {
    bad("unexpected script-parse error", e.message);
  }
}

// The real check: compile as a SourceTextModule.
try {
  new vm.SourceTextModule(app, { identifier: "app.js" });
  ok("app.js parses as an ES module");
} catch (e) {
  bad("app.js ES-module parse", e.message);
}

// Sanity: this validator must CATCH a planted error.
const planted = app + "\nconst __bad = ;\n";
let caught = false;
try { new vm.SourceTextModule(planted, { identifier: "p.js" }); } catch (_) { caught = true; }
caught ? ok("validator catches a planted syntax error") : bad("validator is blind to planted errors");

// --- 2. Every browser file, parsed the right way -----------------------
const files = ["app.js", "sw.js", "firebase-messaging-sw.js"];
for (const f of files) {
  if (!fs.existsSync(f)) { bad(`${f} missing`); continue; }
  const s = fs.readFileSync(f, "utf8");
  try {
    if (/^\s*(import|export)\s/m.test(s)) new vm.SourceTextModule(s, { identifier: f });
    else new vm.Script(s, { filename: f });
    ok(`${f} parses (${/^\s*(import|export)\s/m.test(s) ? "ES module" : "script"})`);
  } catch (e) {
    bad(`${f} does not parse`, e.message);
  }
}

// --- 3. Serverless functions are CommonJS — keep checking those ---------
for (const d of ["api", "utils"]) {
  for (const f of fs.readdirSync(d).filter((x) => x.endsWith(".js"))) {
    const p = `${d}/${f}`;
    try {
      execFileSync(process.execPath, ["--check", p], { stdio: "pipe" });
      ok(`${p} (CommonJS, node --check)`);
    } catch (e) {
      bad(`${p} has a syntax error`, String(e.stderr).split("\n").slice(1, 4).join(" "));
    }
  }
}

// --- 4. Per-function extraction: catch a bad function inside a big file -
{
  const L = app.split(/\r?\n/);
  const names = [];
  for (let i = 0; i < L.length; i++) {
    const m = /^\s*(?:async\s+)?function\s+([A-Za-z0-9_$]+)/.exec(L[i]);
    if (m) names.push({ name: m[1], line: i + 1 });
  }
  let badFn = 0;
  for (const { name, line } of names) {
    const start = L.findIndex((l, i) => i >= line - 1 && l.includes("function " + name));
    if (start === -1) continue;
    let depth = 0, end = start, seen = false;
    for (let i = start; i < L.length; i++) {
      for (const ch of L[i]) { if (ch === "{") { depth++; seen = true; } else if (ch === "}") depth--; }
      if (seen && depth === 0) { end = i; break; }
    }
    const text = L.slice(start, end + 1).join("\n");
    try { new vm.Script(`(async function(){${text}})`); }
    catch (e) { badFn++; bad(`function ${name}() at line ${line} is broken`, e.message); }
  }
  badFn === 0
    ? ok(`all ${names.length} top-level functions parse independently`)
    : console.log(`        (${badFn} broken)`);
}

// --- 5. HTML integrity: a duplicate id strands one element forever --------
//
// WHY THIS EXISTS
// ---------------
// index.html declared id="rosterCount" TWICE: once on the rep's live-roster
// heading, once on the adviser's "Students imported" tile. getElementById
// returns the FIRST match in document order, so the adviser dashboard wrote the
// imported-student count into the rep's hidden heading and the tile kept the
// literal "0" from the markup. Nothing was wrong with the data, the API or the
// rules — the number was going to a different element. The bug was reported
// from a screen thousands of lines away from its cause, and this validator
// could not see it because it never read the markup.
//
// A duplicate id is never intentional, and it always fails the same silent way,
// so it is a hard failure.
{
  const html = fs.readFileSync("index.html", "utf8");
  const lineAt = (s, idx) => s.slice(0, idx).split(/\r?\n/).length;

  const seen = new Map();
  for (const m of html.matchAll(/\sid\s*=\s*"([^"]+)"/g)) {
    if (!seen.has(m[1])) seen.set(m[1], []);
    seen.get(m[1]).push(m.index);
  }
  const dups = [...seen.entries()].filter(([, hits]) => hits.length > 1);
  for (const [id, hits] of dups) {
    bad(
      `duplicate id="${id}" in index.html`,
      `lines ${hits.map((i) => lineAt(html, i)).join(", ")} — getElementById can only ever reach the first`,
    );
  }
  if (!dups.length) ok(`index.html has ${seen.size} ids, none duplicated`);

  // Lookups in app.js that match no element. One is created at runtime by the
  // very code that looks it up; the other is an `if (el)`-guarded lookup for
  // an element that has since left the markup. Anything NOT on this list is a
  // reference renamed on one side only — the bug above in a new costume, and
  // the reason this list stays explicit rather than being a wildcard.
  //
  // `repEnrolledStudentsSection` used to be on this list. It is gone entirely
  // now — the rep's student panel was removed along with the removal feature,
  // so there is no longer a lookup to excuse.
  const INTENTIONALLY_ABSENT = new Set([
    "personalLogContainer", // created on demand, then appended
    "managementToolbar", // guarded; element removed from the markup
  ]);
  const refs = new Map();
  for (const m of app.matchAll(/getElementById\(\s*["']([^"'$]+)["']\s*\)/g)) {
    if (!refs.has(m[1])) refs.set(m[1], []);
    refs.get(m[1]).push(lineAt(app, m.index));
  }
  const missing = [...refs.entries()].filter(
    ([id]) => !seen.has(id) && !INTENTIONALLY_ABSENT.has(id),
  );
  for (const [id, lines] of missing) {
    bad(
      `app.js looks up id="${id}" which is not in index.html`,
      `app.js:${lines.slice(0, 3).join(", ")}${lines.length > 3 ? ` (+${lines.length - 3} more)` : ""}`,
    );
  }
  if (!missing.length) ok(`all ${refs.size} getElementById targets exist`);
}

// --- 6. MOJIBAKE + BOM: the corruption that parses perfectly --------------
//
// WHY THIS IS ITS OWN CHECK
// style.css was once left with its UTF-8 read as Latin-1 and rewritten in
// place: every arrow, em-dash, ellipsis and box-drawing character became two
// or three VISIBLE characters instead (the arrow rendered as U+00E2 followed
// by two more). The file looked fine to a parser and was wrecked to a reader.
//
// That failure is invisible to every other check in this file, which is
// exactly the problem:
//   - it PARSES. Mojibake is valid UTF-8, so U+FFFD is never produced and a
//     "count the replacement characters" test reports zero, every time.
//   - the CSS is still valid; only human-readable text in comments is wrecked.
//   - git shows a large diff, so it reads like a deliberate rewrite.
//
// A mangled file still ends up holding real, valid Unicode, so the only
// reliable signal is the tell-tale LEADING CHARACTER: U+00E2 on its own is the
// signature of UTF-8 bytes decoded once as cp1252. Legitimate copy does not
// begin a word with it. (This comment therefore cannot QUOTE the broken text
// literally — doing so would trip the very check that documents it.)
//
// Asserted as a hard failure, not a warning: shipping it puts visible garbage
// into the source everyone else opens.
{
  const tracked = [
    "style.css", "adviser.css", "role-picker.css", "app.js", "index.html",
    "sw.js", "check.js", "rules-test.js", "firebase-messaging-sw.js",
    "manifest.json", "README.md", "brand/README.md",
    "docs/SECURITY_MODEL.md", "docs/ROADMAP.md", "docs/ARCHITECTURE.md",
    "firestore.rules",
  ];
  const MOJIBAKE_LEAD = "\u00e2";
  let clean = true;
  for (const f of tracked) {
    if (!fs.existsSync(f)) continue;
    const text = fs.readFileSync(f).toString("utf8");
    if (text.charCodeAt(0) === 0xfeff) {
      bad(`${f} starts with a UTF-8 BOM`, "strip it before committing");
      clean = false;
    }
    const idx = text.indexOf(MOJIBAKE_LEAD);
    if (idx !== -1) {
      const line = text.slice(0, idx).split("\n").length;
      bad(
        `${f} contains mojibake`,
        `first at line ${line}: ${JSON.stringify(text.slice(idx - 20, idx + 20))} — ` +
          "decoded as Latin-1 and rewritten",
      );
      clean = false;
    }
  }
  if (clean) ok(`no BOM or mojibake in ${tracked.length} source files`);
}

/**
 * Blank out the CONTENTS of every nested function/arrow body, keeping the
 * surrounding text and line count intact.
 *
 * A reference inside a nested callback runs later (on a click, on a promise),
 * never during the enclosing call, so it cannot reach a temporal dead zone.
 * Without this, `el.cancel.addEventListener("click", () => {
 * adviserPendingCsv = null })` reads as if `adviserPendingCsv` were touched
 * during init — and the check then condemns a dozen long-standing, working
 * declarations that have shipped for months.
 */
function stripNestedBodies(src) {
  // `=> {` is written with a space in practice, so the brace must be allowed
  // after whitespace or the whole strip silently matches nothing.
  const opener = /(?:=>\s*|function\s*\([^)]*\)\s*)\{/g;
  // Comments are blanked first. A name mentioned only in a comment is not a
  // reference — adviserEls() documents the very id it renamed away from, and
  // reading that as a use condemns a declaration that has always been fine.
  let out = src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p + m.slice(p.length).replace(/[^\n]/g, " "));
  for (let guard = 0; guard < 400; guard++) {
    opener.lastIndex = 0;
    let removed = false;
    let m;
    while ((m = opener.exec(out))) {
      let depth = 0;
      let end = -1;
      for (let i = m.index + m[0].length - 1; i < out.length; i++) {
        if (out[i] === "{") depth++;
        else if (out[i] === "}") {
          depth--;
          if (depth === 0) { end = i; break; }
        }
      }
      if (end < 0) break;
      const inner = out.slice(m.index, end + 1);
      const blanked = inner.replace(/[^\n]/g, " "); // preserve line numbers
      out = out.slice(0, m.index) + blanked + out.slice(end + 1);
      opener.lastIndex = m.index + m[0].length;
      removed = true;
    }
    if (!removed) break;
  }
  return out;
}

// --- 7. Module-scope DECLARATION ORDER (temporal dead zone) ---------------
//
// WHY THIS EXISTS
// `initAdviserDashboard()` was called at module top level and referenced
// `removeModal`, a `const` declared ~6000 lines further down. A `const` sits in
// a TEMPORAL DEAD ZONE until its initialiser runs, so the call threw
//
//     ReferenceError: Cannot access 'removeModal' before initialization
//
// which escaped to the top of the module and ABORTED EVALUATION of everything
// after it — including the `onAuthStateChanged()` registration below. Firebase
// signed the user in, nothing was listening for the result, and login silently
// did nothing.
//
// This is invisible to every other check here: the file parses (it is valid
// JavaScript), linters see no undefined variable, and the failure is a RUNTIME
// error on one code path. Only ordering exposes it.
//
// HOW IT IS DETECTED
// `const`/`let` at module scope must be initialised before anything CALLS a
// function that touches them. So:
//   1. collect module-scope `const`/`let` declarations and their lines
//   2. collect module-scope function declarations and their bodies
//   3. find module-scope call statements (column 0, a bare `name(...)`) and
//      which function each invokes, following one level of indirection
//   4. flag any declared name that a called function references, where the
//      declaration sits BELOW the call
{
  const lines = app.split(/\r?\n/);

  // (1) module-scope declarations — column 0, so nested ones are ignored
  const decls = new Map(); // name -> line number
  lines.forEach((line, i) => {
    const m = /^(?:const|let)\s+([A-Za-z0-9_$]+)\s*=/.exec(line);
    if (m) decls.set(m[1], i + 1);
  });

  // (2) function declarations + the span of their body
  const fns = new Map(); // name -> {line, body}
  for (let i = 0; i < lines.length; i++) {
    const m = /^(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/.exec(lines[i]);
    if (!m) continue;
    let depth = 0, started = false, end = i;
    for (let j = i; j < lines.length; j++) {
      for (const ch of lines[j]) {
        if (ch === "{") { depth++; started = true; }
        else if (ch === "}") depth--;
      }
      if (started && depth === 0) { end = j; break; }
    }
    fns.set(m[1], {
      line: i + 1,
      body: lines.slice(i, end + 1).join("\n"),
      // The body with every NESTED function/arrow body removed. A reference
      // inside `addEventListener("click", () => {...})` is evaluated when the
      // adviser clicks, long after module evaluation has finished, so it cannot
      // hit a temporal dead zone. Only references that run DURING the call can.
      topLevel: stripNestedBodies(lines.slice(i, end + 1).join("\n")),
    });
  }

  // (3) module-scope call statements, plus one level of indirection
  const calls = []; // {line, targets:[fnName]}
  lines.forEach((line, i) => {
    const m = /^([A-Za-z0-9_$]+)\s*\(/.exec(line);
    if (!m) return;
    const name = m[1];
    if (decls.has(name)) return;               // `const x = x()` — not a call stmt
    // Skip the function's own DECLARATION line, but NOT a bare `foo();` call of
    // it. Matching on the name alone silently dropped every real call site,
    // which is what made the first version of this check pass a file that was
    // actively throwing. Only the `function` keyword identifies the former.
    if (/^(?:async\s+)?function\s+/.test(line)) return;
    // `targets` is filled in by the indirection pass below.
    calls.push({ line: i + 1, name, targets: fns.has(name) ? [name] : [] });
  });

  // one level of indirection: if the called function calls others, include them
  for (const call of calls) {
    const reached = new Set();
    const walk = (fnName) => {
      if (reached.has(fnName)) return;
      reached.add(fnName);
      const fn = fns.get(fnName);
      if (!fn) return;
      for (const other of fns.keys()) {
        // Follow only calls that happen DURING this call. A `foo()` sitting inside
      // a nested click-handler is stripped by stripNestedBodies, so it is not
      // followed — which is what stops adviserApi() (invoked on user action)
      // being treated as reachable from initAdviserDashboard().
      if (other !== fnName && new RegExp(`\\b${other}\\s*\\(`).test(fn.topLevel)) {
          walk(other);
        }
      }
    };
    walk(call.name);
    call.targets = [...reached];
  }

  // (4) flag declaration-after-use
  const violations = [];
  for (const call of calls) {
    for (const target of call.targets) {
      const fn = fns.get(target);
      if (!fn) continue;
      for (const [name, declLine] of decls) {
        if (declLine <= call.line) continue;              // already initialised
        if (!new RegExp(`\\b${name}\\b`).test(fn.topLevel)) continue;
        violations.push(
          `${name} (declared line ${declLine}) is used by ${target}(), ` +
            `which is called at line ${call.line}`,
        );
      }
    }
  }

  if (!violations.length) {
    ok(`module-scope declaration order is safe (${decls.size} const/let, ${calls.length} call sites)`);
  } else {
    const uniq = [...new Set(violations)];
    bad(
      `module-scope declaration order can throw a temporal-dead-zone ReferenceError`,
      uniq.slice(0, 6).join("\n        ") +
        (uniq.length > 6 ? `\n        ...and ${uniq.length - 6} more` : "") +
        "\n        A module-scope const/let must be declared ABOVE any call that reaches it.",
    );
  }
}

console.log(fails === 0 ? "\nALL PARSED CLEAN" : `\n${fails} PROBLEM(S)`);
process.exit(fails === 0 ? 0 : 1);
