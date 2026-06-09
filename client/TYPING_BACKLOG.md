# Runtime Client Typing Backlog

This tracks the remaining `runtime/client/js` source files that still need TypeScript conversion.

Status:

- The meaningful `runtime/client` typecheck is now passing.
- This does not mean the runtime is fully converted.
- The remaining work is the JS/JSX source surface listed below.
- Prefer importing helpers from `@Sk` instead of reaching into `Sk.*` directly.
- Avoid introducing `any` in new conversions unless there is no practical alternative.

Included support files:

- `js/@types/reset.d.ts` is the ambient reset shim. It stays in the project and relies on `js/globals.d.ts` for the CSS property augmentations that keep it compatible with TS 6.

Excluded from this audit:

- `js/lib/*.js` and `js/lib/*.min.js` are vendored assets.
- `js/runner/components-in-js/packages/**` is generated/build output or package-internal code that is not part of the manual conversion backlog.

Initial conversion candidates: `27` source files. Current remaining first-party candidates are listed below.

Worth converting first:

- none remaining. The remaining files are either large (`modules/anvil.js`, `components/GoogleMap.js`), low-value (`components/SimpleCanvas.js`), or generated/vendor-like (`extra-python-modules.js`).

Recently converted:

- `components.js`
- `modules/base64.js`
- `modules/code-completion-hints.js`
- `modules/http.js`
- `modules/image.js`
- `modules/js.js`
- `modules/media.js`
- `modules/regex.js`
- `modules/shapes.js`
- `modules/tz.js`
- `messages.js`
- all `PyDefUtils/*.js` candidates
- `modules/xml.js`

Defer for now:

- `extra-python-modules.js` is a generated Plotly blob.
- `modules/anvil.js` is large enough to defer out of the small-module batch.
- `components/SimpleCanvas.js` is small, but not worth the conversion cost right now.
- `components/GoogleMap.js` is in the same bracket; it is large and JSX-heavy.

## Root

- `extra-python-modules.js`

## Components

- `components/GoogleMap.js`
- `components/SimpleCanvas.js`

## Modules

- `modules/anvil.js`
