// Fast drop-in for make.fun's csv-reader 1.0.0.
//
// The reference reads one character at a time and builds every field with
// `value += c`. That is slow for two reasons: the per-character loop, and
// the string concatenation. This reader keeps the reference's exact policy
// (see the competition rules) but works field-by-field with native scans:
//
// - An unquoted field ends at the first comma or LF. `indexOf` finds both
//   in native code, then one `slice` takes the whole field. A CR inside
//   that slice is the only thing that needs a second look: a CR right
//   before the LF is the CRLF line break, every other CR is a stray CR
//   (one `stray_cr` error each, dropped from the value).
// - A quoted field ends at the first quote that is not doubled.
//   `indexOf('"')` finds candidate quotes in native code; a quote followed
//   by another quote is doubled and skipped. The content is then one
//   slice, with `""` -> `"` and CRLF / lone CR -> LF done by native
//   `replaceAll`, only when the content actually holds them.
// - Line numbers only matter as the line a record starts on. Every error
//   of a record is reported with that start line, so the parser only has
//   to keep `line` correct for the next record: LF and CRLF outside quotes
//   count once, and every LF / CRLF / lone CR inside quotes counts once.
// - Fields are never trimmed or converted, and stay as (mostly sliced)
//   strings. `slice` on a JS string is a cheap view of the parent text,
//   so the common unquoted field costs one native scan plus one slice.
//
// No caching between cases: `run` builds everything fresh per call.

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const n = text.length;
  let pos = 0;
  let line = 1;
  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The line / row of the record currently being read; every error of
  // that record is reported with these, exactly as the reference does.
  let recordLine = 1;
  let recordRow = null;

  function error(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Reads an unquoted field starting at `pos`, onto `init` ("" for a
  // plain field, the quoted content for quote junk). Returns the field
  // and how it ended; `added` counts the characters kept from this call
  // (stray CRs are dropped and not counted).
  function readUnquoted(init) {
    let value = init;
    let added = 0;
    let iComma = text.indexOf(",", pos);
    let iLF = text.indexOf("\n", pos);
    if (iComma === -1) iComma = n;
    if (iLF === -1) iLF = n;
    let end;
    let ended;
    if (iComma < iLF) {
      end = iComma;
      ended = "comma";
    } else if (iLF < iComma) {
      end = iLF;
      ended = "line";
    } else {
      end = n;
      ended = "end";
    }
    const seg = text.slice(pos, end);
    const cr = seg.indexOf("\r");
    if (cr === -1) {
      value += seg;
      added += seg.length;
    } else {
      // A CR at the end of a line-ending segment is the CRLF break;
      // every other CR in the segment is stray.
      const isCRLF = ended === "line" && seg.charCodeAt(seg.length - 1) === 13;
      let crCount = 0;
      for (let i = 0; i < seg.length; i++) {
        if (seg.charCodeAt(i) === 13) crCount++;
      }
      const stray = isCRLF ? crCount - 1 : crCount;
      for (let k = 0; k < stray; k++) error("stray_cr");
      if (isCRLF) {
        value += seg.slice(0, -1).replaceAll("\r", "");
      } else {
        value += seg.replaceAll("\r", "");
      }
      added += seg.length - crCount;
    }
    if (ended === "comma") {
      pos = end + 1;
    } else if (ended === "line") {
      pos = end + 1;
      line += 1;
    } else {
      pos = end;
    }
    return { value, ended, added };
  }

  // Reads a quoted field whose opening quote is at `pos`.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let start = pos + 1;
    let q;
    // Find the closing quote: a quote followed by another quote is
    // doubled (one literal quote) and does not close the field.
    for (;;) {
      q = text.indexOf('"', start);
      if (q === -1) {
        // Never closes: the quote is literal, and the text after it is
        // read again as an unquoted field.
        pos = open + 1;
        line = openLine;
        error("unterminated_quote");
        return readUnquoted('"');
      }
      if (q + 1 < n && text.charCodeAt(q + 1) === 34) {
        start = q + 2;
        continue;
      }
      break;
    }
    // Content is [open+1, q). Doubled quotes and line breaks inside it
    // are normalised with native replaces, only when present.
    let raw = text.slice(open + 1, q);
    let hasCR = raw.indexOf("\r") !== -1;
    let hasLF = raw.indexOf("\n") !== -1;
    let value = raw;
    if (raw.indexOf('""') !== -1) value = value.replaceAll('""', '"');
    if (hasCR) {
      value = value.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
      hasLF = true;
    }
    if (hasLF) {
      // After normalisation every line break inside the quotes is one
      // LF, so counting LFs counts the lines to add.
      let breaks = 0;
      for (let i = 0; i < value.length; i++) {
        if (value.charCodeAt(i) === 10) breaks++;
      }
      line += breaks;
    }
    pos = q + 1;
    if (pos >= n) return { value, ended: "end" };
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      return { value, ended: "comma" };
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      return { value, ended: "line" };
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      return { value, ended: "line" };
    }
    // What follows the closing quote is appended as it stands, up to
    // the next comma or line break.
    const junk = readUnquoted(value);
    if (junk.added > 0) error("quote_junk");
    return junk;
  }

  for (;;) {
    // Lines left with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let field;
    let quoted;
    do {
      quoted = text.charCodeAt(pos) === 34;
      field = quoted ? readQuoted() : readUnquoted("");
      fields.push(field.value);
    } while (field.ended === "comma");

    // A line that held only stray CRs is left with no characters: no
    // record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === "" && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: "short_row", line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push("");
    } else if (fields.length > width) {
      errors.push({ code: "long_row", line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? columns ?? [] : null, rows, errors };
}
