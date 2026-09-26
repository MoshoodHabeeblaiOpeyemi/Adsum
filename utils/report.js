// VeriPresenX — attendance reporting: semester roll-up and file export.
//
// Split out from app.js because the maths is the part worth testing, and
// testing it inside an 8,000-line browser bundle is impractical. The UI calls
// these and renders the result; nothing here touches the DOM.

/** Local timestamp reader, so this module needs no imports. */
function toMillis(v) {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "object" && typeof v.toMillis === "function") return v.toMillis();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

const norm = (v) => String(v || "").trim().toUpperCase();

/**
 * Build a per-student semester report for one course.
 *
 * @param {Array} attendanceHistory  closed sessions, any order
 * @param {Array} members            {matric, name}
 *
 * A session counts as ATTENDED when the student's matric is in that session's
 * `attendees[]`. `flaggedAbsent` is deliberately NOT subtracted: a flag is a
 * staff decision, and the rep may flag someone who was vouched for. Counting
 * both would make one session count twice or not at all depending on order.
 */
function buildSemesterReport(attendanceHistory, members) {
  const sessions = (Array.isArray(attendanceHistory) ? attendanceHistory : [])
    .filter((r) => r && Array.isArray(r.attendees))
    // Oldest first, so "Session 1" is the first class held rather than whichever
    // the listener happened to deliver first.
    .slice()
    .sort((a, b) => {
      const at = toMillis(a.closedAt) ?? 0;
      const bt = toMillis(b.closedAt) ?? 0;
      if (at !== bt) return at - bt;
      return String(a.date || "").localeCompare(String(b.date || ""));
    });

  const rows = (Array.isArray(members) ? members : []).map((m) => {
    const matric = norm(m.matric);
    let attended = 0;
    const present = [];
    sessions.forEach((s, i) => {
      if ((s.attendees || []).some((x) => norm(x) === matric)) {
        attended++;
        present.push(i + 1);
      }
    });
    const total = sessions.length;
    return {
      matric: m.matric,
      name: m.name || m.matric,
      attended,
      total,
      // Whole numbers only. "66.7%" implies precision a 20-student class
      // cannot support.
      percent: total === 0 ? 0 : Math.round((attended / total) * 100),
      sessions: present,
    };
  });

  rows.sort((a, b) => b.percent - a.percent || String(a.name).localeCompare(String(b.name)));
  return { sessions: sessions.length, rows, generatedAt: new Date().toISOString() };
}

/** Per-session CSV, one row per attendee. */
function sessionCsv(history, members) {
  const nameOf = (matric) => {
    const m = (members || []).find((x) => norm(x.matric) === norm(matric));
    return (m && m.name ? String(m.name) : "").replace(/"/g, "'");
  };
  let out = "Name,Matric Number,Status\r\n";
  (history.attendees || []).forEach((matric) => {
    out += `"${nameOf(matric)}","${norm(matric)}","Present"\r\n`;
  });
  return out;
}

/**
 * Whole-semester CSV: one row per student, with a column per session.
 *
 * The per-session columns matter: "absent on the 3rd" is a different
 * conversation from "60% overall", and a single percentage cannot answer either.
 */
function semesterCsv(report) {
  const esc = (v) => `"${String(v == null ? "" : v).replace(/"/g, "'")}"`;
  let out = "Name,Matric Number";
  for (let i = 1; i <= report.sessions; i++) out += `,Session ${i}`;
  out += ",Classes Attended,Total Classes,Attendance %\r\n";
  report.rows.forEach((r) => {
    let line = `${esc(r.name)},${esc(r.matric)}`;
    for (let i = 1; i <= report.sessions; i++) {
      line += `,${r.sessions.includes(i) ? "P" : "A"}`;
    }
    out += `${line},${r.attended},${r.total},${r.percent}%\r\n`;
  });
  return out;
}

/**
 * A print-ready HTML document. "PDF" here means: open the browser's print
 * dialog and let the user choose Save as PDF.
 *
 * Why not a PDF library: it is a large dependency for a file nobody parses
 * programmatically, it produces a fixed layout that breaks on a phone, and the
 * browser already does this better — selectable text, real fonts, works
 * offline. A rep on a laptop gets a correct document in one click.
 */
function semesterPrintHtml(report, course) {
  const esc = (v) =>
    String(v == null ? "" : v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  const title = `${esc(course && course.code ? course.code : "Course")} - Attendance Report`;
  const rows = report.rows
    .map(
      (r) =>
        `<tr><td>${esc(r.name)}</td><td class="num">${esc(r.matric)}</td>` +
        `<td class="num">${r.attended}/${r.total}</td>` +
        `<td class="num"><strong>${r.percent}%</strong></td></tr>`,
    )
    .join("");
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         color: #16233a; margin: 32px; line-height: 1.5; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { color: #5a6b82; font-size: 13px; margin: 0 0 20px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #dfe5ec; }
  th { background: #f4f7fa; font-weight: 700; }
  .num { text-align: right; }
  .foot { margin-top: 18px; font-size: 11px; color: #7a8ba1; }
  .noprint { margin-bottom: 16px; }
  button { font: inherit; padding: 9px 16px; border-radius: 8px; cursor: pointer;
           border: 1px solid #16233a; background: #16233a; color: #fff; }
  @media print { body { margin: 12mm; } .noprint { display: none; } }
</style></head>
<body>
  <div class="noprint"><button onclick="window.print()">Save as PDF / Print</button></div>
  <h1>${title}</h1>
  <p class="sub">${report.sessions} class${report.sessions === 1 ? "" : "es"} held
     &middot; ${report.rows.length} student${report.rows.length === 1 ? "" : "s"}
     &middot; generated ${esc(new Date().toLocaleString())}</p>
  <table>
    <thead><tr><th>Name</th><th class="num">Matric</th>
      <th class="num">Attended</th><th class="num">%</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="4">No students enrolled yet.</td></tr>'}</tbody>
  </table>
  <p class="foot">Generated by VeriPresenX. A session counts as attended when the
     student's matric was recorded present for that class.</p>
</body></html>`;
}

// Browser entry point. app.js loads this file as a classic script (the
// app imports Firebase from CDN URLs, so bare-specifier imports are not
// available), and reads the helpers off this global. The CommonJS export
// is kept below for the node unit tests.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { buildSemesterReport, sessionCsv, semesterCsv, semesterPrintHtml, toMillis };
}
if (typeof globalThis !== "undefined") {
  globalThis.VeriReport = { buildSemesterReport, sessionCsv, semesterCsv, semesterPrintHtml, toMillis };
}