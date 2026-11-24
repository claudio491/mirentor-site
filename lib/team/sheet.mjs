// sheet.mjs: what leaves the app for a spreadsheet. Every export ends in a sheet: record.csv opens in Sheets, and the
// CRM bridge writes GET export and GET sitereports into Google Sheets cell by cell (Range.setValues), which reads a
// text that starts with = + - @ (or a tab or a return) as a formula. One rule for all of them: such a text goes out with
// an apostrophe in front, which makes the sheet keep it as text and hide the apostrophe. Numbers, dates and ids are
// never passed through here.

/** A text a person typed, as a sheet must receive it. Anything that is not a string is answered as it is. */
export const sheetText = (v) => (typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v);
