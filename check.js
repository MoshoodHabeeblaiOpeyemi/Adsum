// VeriPresenX — syntax validator
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

  // Lookups in app.js that match no element. Two are created at runtime by the
  // very code that looks them up; the third is an `if (el)`-guarded lookup for
  // an element that has since left the markup. Anything NOT on this list is a
  // reference renamed on one side only — the bug above in a new costume, and
  // the reason this list stays explicit rather than being a wildcard.
  const INTENTIONALLY_ABSENT = new Set([
    "repEnrolledStudentsSection", // created on demand, then appended
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

console.log(fails === 0 ? "\nALL PARSED CLEAN" : `\n${fails} PROBLEM(S)`);
process.exit(fails === 0 ? 0 : 1);
