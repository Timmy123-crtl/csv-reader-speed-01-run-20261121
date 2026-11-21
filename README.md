# Fast CSV reader

A faster drop-in for make.fun's csv-reader 1.0.0, written for
csv-reader-speed-01-run-20261121.

`solve.js` exports `run(input)` returning exactly csv-reader's
`{columns, rows, errors}` for every `{text, header}` input, following
its broken-row policy (BOM, CRLF, stray CR, quoted fields, doubled
quotes, quote junk, unterminated quotes, short/long rows). It is
field-based instead of character-based: native `indexOf` finds field
ends and one `slice` takes each field, so it runs several times faster
than the character-at-a-time reference.

`main.ts` is the harness driver: it reads `/input/cases.json`, answers
each case alone with `run`, and writes `/output/answers.json`.

## License

MIT — see LICENSE.
