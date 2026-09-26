// VeriPresenX — roster CSV parsing.
//
// Split out from api/roster.js so it can be unit-tested without Firestore, and
// so a malformed upload is reported as a DATA problem rather than a server
// error. The adviser is uploading a spreadsheet exported by a human being, so
// the parser has to be forgiving about the things humans get wrong (BOM from
// Excel, a `matric number` header, CRLF vs LF, a trailing blank line) and
// strict about the one thing that matters (a usable, non-duplicate matric).

/** Strip a UTF-8 BOM. Excel writes one, and it silently corrupts the first header. */
const stripBom = (s) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);

/**
 * Split one CSV line, honouring double-quoted fields and "" as an escaped quote.
 * Hand-rolled because there is no CSV library in this project and the only
 * dependency is firebase-admin.
 */
function splitLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = false; }
      } else { cur += ch; }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur); cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

/** Normalise a header cell so `Matric Number`, `matric_number` and `MATRIC` all match. */
const normHeader = (h) => String(h || "").trim().toLowerCase().replace(/[^a-z]/g, "");

const MAX_ROWS = 5000;
const MAX_FIELD = 120;

/**
 * Parse a roster CSV into `{ students, errors, warnings }`.
 *
 * Required column: matric (aliases: matricnumber, matricno, registrationnumber,
 * regno). Optional: name, email.
 *
 * Never throws. Rows are validated one at a time and every rejection is
 * reported with its 1-based line number, so the adviser can fix the file rather
 * than guess. A file with any invalid row is REJECTED wholesale — importing 40
 * of 43 students silently is worse than importing none, because the missing 3
 * would be invisible until someone fails to check in.
 */
function parseRosterCsv(text) {
  const result = { students: [], errors: [], warnings: [] };
  const raw = stripBom(String(text == null ? "" : text));
  if (!raw.trim()) {
    result.errors.push({ line: 0, message: "The file is empty." });
    return result;
  }

  const lines = raw.split(/\r\n|\n|\r/).filter((l) => l.trim() !== "");
  if (!lines.length) {
    result.errors.push({ line: 0, message: "The file is empty." });
    return result;
  }

  const header = splitLine(lines[0]).map(normHeader);
  const matricIdx = header.findIndex((h) =>
    ["matric", "matricnumber", "matricno", "matricnum", "registrationnumber", "regno", "registrationno"].includes(h),
  );
  if (matricIdx === -1) {
    result.errors.push({
      line: 1,
      message: 'No "matric" column found. Expected a header row with a column named Matric (or Registration Number).',
    });
    return result;
  }
  const nameIdx = header.findIndex((h) => ["name", "fullname", "studentname", "student"].includes(h));
  const emailIdx = header.findIndex((h) => ["email", "emailaddress", "mail"].includes(h));

  if (!emailIdx || emailIdx === -1) {
    result.warnings.push("No email column found. Students will still be able to enrol using their matric number.");
  }

  const seen = new Set();
  for (let i = 1; i < lines.length; i++) {
    const lineNo = i + 1;
    if (result.students.length >= MAX_ROWS) {
      result.errors.push({ line: lineNo, message: `Too many rows — the limit is ${MAX_ROWS} students per roster.` });
      break;
    }
    const cells = splitLine(lines[i]);

    // `norm()` matches api/account.js: matric is the identity key and must
    // compare identically everywhere, or one student becomes two.
    const matric = String(cells[matricIdx] || "").trim().toUpperCase();
    if (!matric) {
      result.errors.push({ line: lineNo, message: "Missing matric number." });
      continue;
    }
    if (matric.length > MAX_FIELD) {
      result.errors.push({ line: lineNo, message: "Matric number is too long." });
      continue;
    }
    // Duplicates inside one upload are an error, not a silent overwrite: the
    // count the adviser is shown must match the list that was stored.
    if (seen.has(matric)) {
      result.errors.push({ line: lineNo, message: `Duplicate matric ${matric} in this file.` });
      continue;
    }
    seen.add(matric);

    const name = nameIdx >= 0 ? String(cells[nameIdx] || "").trim().slice(0, MAX_FIELD) : "";
    let email = emailIdx >= 0 ? String(cells[emailIdx] || "").trim().toLowerCase().slice(0, MAX_FIELD) : "";
    // Drop an obviously malformed address rather than storing junk we would
    // later have to trust. A blank email is fine — matric is the real key.
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      result.warnings.push(`Line ${lineNo}: "${email}" is not a valid email and was ignored.`);
      email = "";
    }
    if (!name) {
      result.warnings.push(`Line ${lineNo}: no name supplied — the roster will show the matric.`);
    }

    result.students.push({ matric, name, email });
  }

  if (!result.students.length && !result.errors.length) {
    result.errors.push({ line: 0, message: "No student rows found under the header." });
  }
  return result;
}

module.exports = { parseRosterCsv, splitLine, normHeader, stripBom, MAX_ROWS };
