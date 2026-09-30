// Adsum — roster CSV parsing.
//
// Split out from api/roster.js so it can be unit-tested without Firestore, and
// so a malformed upload is reported as a DATA problem rather than a server
// error.
//
// THE BRIEF: the adviser exports a spreadsheet from whatever their department
// happens to use. We do not get to specify the format. So the parser:
//   1. matches a generous list of header names (Matric No, S/No, S/N, Reg No…),
//   2. falls back to DETECTING the matric column by the shape of its values,
//   3. survives a missing header row entirely,
//   4. combines Surname + Other Names the way Nigerian department sheets do,
//   5. and is forgiving everywhere except the one thing that matters: a usable,
//      non-duplicate matric.
//
// Everything it can live with is a warning. Only a broken identity is an error.

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

/**
 * Reduce a header cell to a comparable key: lowercase, letters and digits only.
 * This is what makes "Matric No.", "matric_no", "MATRIC NO" and "MatricNo" all
 * collapse to the same token. Note "S/No" → "sno" and "S/N" → "sn", so the alias
 * list below carries both.
 */
const normHeader = (h) => String(h || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");

// --- header aliases -------------------------------------------------------
// Matric column headings.
//
// ⚠️ ORDER IS PRIORITY, and the weak ones come last.
//
// A department sheet very often has BOTH an "S/N" (serial number) column and a
// "Matric No" column. findCol() returns the first column whose heading matches
// ANY alias, so a single flat list lets "S/N" win and the roster is imported
// with 1, 2, 3, 4... in the Matric column. That is not a near miss — it produces
// a roster where every student is unidentifiable, and it is invisible in the
// preview unless the adviser reads it carefully.
//
// So the strong, unambiguous names are tried across EVERY column first. Only if
// none of them match do we fall back to the weak names, which are commonly
// serial numbers.
const MATRIC_HEADERS_STRONG = [
  "matric", "matricno", "matricnumber", "matricnum", "matriccode", "matricid",
  "registrationnumber", "registrationno", "regno", "regnumber", "registration",
  "studentnumber", "studentno", "studentid",
];
// Ambiguous on their own: "S/N" is a serial number as often as it is a
// registration number, and "No" / "ID" / "Number" are usually row counters.
const MATRIC_HEADERS_WEAK = [
  "sno", "sn", "serialno", "serialnumber", "serial",
  "no", "number", "id", "indexnumber", "indexno",
];
const MATRIC_HEADERS = [...MATRIC_HEADERS_STRONG, ...MATRIC_HEADERS_WEAK];

const NAME_HEADERS = ["name", "fullname", "studentname", "student", "names"];
const SURNAME_HEADERS = ["surname", "lastname", "familyname"];
// 🔑 "middlename" is NOT here. It used to be, which meant a sheet carrying
// Surname / Middle Name / Other Names matched on "Middle Name" and silently
// dropped the third column. The three are distinct parts of one name and are
// now parsed separately, then recombined in the correct order.
const MIDDLE_NAME_HEADERS = ["middlename", "middlenames", "midname"];
const OTHERNAME_HEADERS = ["othernames", "othername", "givenname", "givennames", "firstname", "firstnames"];
const EMAIL_HEADERS = ["email", "emailaddress", "mail", "e-mail", "emailaddr"];

/**
 * Matric shapes seen in Nigerian universities, in preference order. The brief
 * names `\d{2}/\d{2}[A-Z]{2}\d{3}` (e.g. 24/56SV002); the rest are what real
 * exports turn out to contain. These are only used to DETECT a column when the
 * header is unhelpful, never to reject a value.
 */
const MATRIC_PATTERNS = [
  /^\d{2}\/\d{2}[A-Z]{2}\d{3,4}$/i,      // 24/56SV002  (the documented form)
  /^\d{2}\/\d{2}[A-Z]+\d{3,4}$/i,       // 24/56ABC001
  /^[A-Z]{2,4}\/\d{2,4}[A-Z]{2}\d{3}$/i, // UNIL/24GE001
  /^\d{4}\/\d{4,5}$/,                    // 2024/56789
  /^[A-Z]{2,4}\d{4,8}$/i,                // UNIL240001
  /^\d{6,12}$/,                          // 2024001234
];

/** Does this cell look like a matric number? Used to sniff an unlabelled column. */
function looksLikeMatric(value) {
  const v = String(value || "").trim();
  if (!v || v.length > 24 || /\s/.test(v)) return false;
  return MATRIC_PATTERNS.some((re) => re.test(v));
}

/**
 * Score a column as "the matric column" by how many of its values match a
 * known matric shape. Used only when the header names give us nothing, so a
 * single unusual value cannot lose a genuinely correct column.
 */
function sniffMatricColumn(rows, colCount) {
  let best = -1;
  let bestScore = 0;
  for (let c = 0; c < colCount; c++) {
    const values = rows.map((r) => (r[c] || "").trim()).filter(Boolean);
    if (values.length < 2) continue;
    const hits = values.filter(looksLikeMatric).length;
    const ratio = hits / values.length;
    if (ratio >= 0.7 && hits > bestScore) { bestScore = hits; best = c; }
  }
  return best;
}


const MAX_ROWS = 5000;
const MAX_FIELD = 120;

/** Does this row look like a header rather than data? Used to find a missing header. */
function looksLikeHeaderRow(cells) {
  // A header cell is words; a data cell in the matric column is not. If the
  // row already contains something that parses as a matric, it is data.
  if (cells.some(looksLikeMatric)) return false;
  const nonEmpty = cells.filter((c) => c && String(c).trim());
  if (!nonEmpty.length) return false;
  const numericish = nonEmpty.filter((c) => /^\d+$/.test(String(c).trim())).length;
  return numericish < nonEmpty.length;
}

/**
 * Parse a roster CSV into `{ students, errors, warnings, detected }`.
 *
 * Never throws. Every rejection is reported with its 1-based line number so the
 * adviser can fix the file rather than guess. A file with any invalid row is
 * REJECTED wholesale — importing 40 of 43 students silently is worse than
 * importing none, because the missing 3 stay invisible until someone fails to
 * check in.
 */
function parseRosterCsv(text) {
  const result = { students: [], errors: [], warnings: [], detected: {} };
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

  let headerCells = splitLine(lines[0]);

  // --- no header row at all: sniff the column from the data ---------------
  if (!looksLikeHeaderRow(headerCells)) {
    const allRows = lines.map(splitLine);
    const colCount = Math.max(0, ...allRows.map((r) => r.length));
    const sniffed = sniffMatricColumn(allRows, colCount);
    if (sniffed === -1) {
      result.errors.push({
        line: 1,
        message:
          'No matric column could be found. The file needs a column of matric numbers (like 24/56SV002) — either under a heading such as "Matric No", "S/No" or "Reg No", or as the first column.',
      });
      return result;
    }
    result.detected = { matric: sniffed, by: "pattern", header: false };
    result.warnings.push(
      `No heading row found. The matric column was detected from the shape of its values (column ${sniffed + 1}). Please check the preview before saving.`,
    );
    return buildRows(allRows, { matricIdx: sniffed }, result, 0);
  }

  // Skip a title/banner line sitting above the real header.
  let headerRowIdx = 0;
  if (headerCells.filter((c) => c && String(c).trim()).length < 2 && lines[1]) {
    headerRowIdx = 1;
    headerCells = splitLine(lines[1]);
  }

  const header = headerCells.map(normHeader);
  const findCol = (aliases) => header.findIndex((h) => aliases.includes(h));

  let matricIdx = findCol(MATRIC_HEADERS_STRONG);
  let detectedBy = "header";

  // 🔑 STRONG HEADINGS FIRST, EVERYWHERE. A sheet with both "S/N" and "Matric
  // No" must resolve to "Matric No" even though "S/N" sits in column 0 and
  // matches an alias. Only if NO strong heading exists anywhere do we accept a
  // weak one, and those are commonly row counters — so the choice is warned
  // about rather than made silently.
  if (matricIdx === -1) {
    matricIdx = findCol(MATRIC_HEADERS_WEAK);
    if (matricIdx !== -1) {
      result.warnings.push(
        `No column was headed "Matric", so "${headerCells[matricIdx] || "column " + (matricIdx + 1)}" was used as the identifier. If that column is just a serial number (S/N), remove it and re-upload, or the roster will not match any student.`,
      );
    }
  }

  // No usable heading at all: fall back to sniffing the values.
  if (matricIdx === -1) {
    const dataRows = lines.slice(headerRowIdx + 1).map(splitLine);
    const colCount = Math.max(header.length, 0, ...dataRows.map((r) => r.length));
    const sniffed = sniffMatricColumn(dataRows, colCount);
    if (sniffed === -1) {
      result.errors.push({
        line: headerRowIdx + 1,
        message:
          'No matric column found. Expected a heading like "Matric", "Matric No", "S/No" or "Reg No" — or a column of values like 24/56SV002.',
      });
      return result;
    }
    matricIdx = sniffed;
    detectedBy = "pattern";
    result.warnings.push(
      `The matric column was detected from the shape of its values (column ${matricIdx + 1}) rather than by its heading. Please check the preview.`,
    );
  }

  const nameIdx = findCol(NAME_HEADERS);
  const surnameIdx = findCol(SURNAME_HEADERS);
  const middleIdx = findCol(MIDDLE_NAME_HEADERS);
  const otherIdx = findCol(OTHERNAME_HEADERS);
  const emailIdx = findCol(EMAIL_HEADERS);
  result.detected = { matric: matricIdx, by: detectedBy, header: true };

  if (emailIdx === -1) {
    result.warnings.push("No email column found. Students can still enrol using their matric number.");
  }
  if (nameIdx === -1 && surnameIdx === -1 && middleIdx === -1) {
    result.warnings.push("No name column found. Students will appear on the roster by matric number only.");
  }

  return buildRows(
    lines.slice(headerRowIdx + 1).map(splitLine),
    { matricIdx, nameIdx, surnameIdx, middleIdx, otherIdx, emailIdx },
    result,
    headerRowIdx + 1,
  );
}

/** Turn parsed rows into students, validating each one. Shared by both paths. */
function buildRows(rows, cols, result, lineOffset) {
  const { matricIdx, nameIdx = -1, surnameIdx = -1, middleIdx = -1, otherIdx = -1, emailIdx = -1 } = cols;
  const seen = new Set();

  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i];
    // +1 for 1-based lines, +lineOffset for the header we skipped, so the
    // number matches what the adviser sees in Excel.
    const lineNo = lineOffset + i + 1;

    if (result.students.length >= MAX_ROWS) {
      result.errors.push({ line: lineNo, message: `Too many rows — the limit is ${MAX_ROWS} students per roster.` });
      break;
    }
    // A wholly empty row is skipped, not failed: trailing blank lines are not
    // a data problem.
    const hasAny = cells.some((c) => c && String(c).trim());
    if (!hasAny) continue;
    if (!String(cells[matricIdx] || "").trim()) {
      result.errors.push({ line: lineNo, message: "Missing matric number." });
      continue;
    }

    // `norm()` matches api/account.js: the matric is the identity key and must
    // compare identically everywhere, or one student becomes two.
    const matric = String(cells[matricIdx] || "").trim().toUpperCase();
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

    // A Nigerian department sheet lays a name out as Surname / Middle Name /
    // Other Names. All three are distinct parts of ONE name, so they are read
    // separately and joined in that order. Every part is optional, so a two- or
    // one-column sheet produces the same shape without special-casing.
    const surname = surnameIdx >= 0 ? String(cells[surnameIdx] || "").trim() : "";
    const middle = middleIdx >= 0 ? String(cells[middleIdx] || "").trim() : "";
    const other = otherIdx >= 0 ? String(cells[otherIdx] || "").trim() : "";
    const single = nameIdx >= 0 ? String(cells[nameIdx] || "").trim() : "";

    // Prefer the three-column layout; fall back to a single full-name column.
    const combined = [surname, middle, other].filter(Boolean).join(" ").trim();
    const name = (combined || single)
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_FIELD);

    let email = emailIdx >= 0 ? String(cells[emailIdx] || "").trim().toLowerCase().slice(0, MAX_FIELD) : "";
    // Drop an obviously malformed address rather than storing junk we would
    // later have to trust. A blank email is fine — the matric is the real key.
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      result.warnings.push(`Line ${lineNo}: "${email}" is not a valid email and was ignored.`);
      email = "";
    }
    if (!name) {
      result.warnings.push(`Line ${lineNo}: no name supplied — this student will show as their matric number.`);
    }

    // The three parts are stored alongside the combined name, additively.
    // Existing readers only touch .matric / .name / .email, so api/roster.js and
    // the client preview keep working unchanged.
    result.students.push({
      matric,
      name,
      surname: surname || null,
      middleName: middle || null,
      otherNames: other || null,
      email,
    });
  }

  if (!result.students.length && !result.errors.length) {
    result.errors.push({ line: 0, message: "No student rows were found in the file." });
  }
  return result;
}

module.exports = {
  parseRosterCsv,
  splitLine,
  normHeader,
  stripBom,
  looksLikeMatric,
  sniffMatricColumn,
  looksLikeHeaderRow,
  MAX_ROWS,
};