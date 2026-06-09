# CodeRabbit Triage

This file tracks CodeRabbit items for the runtime TypeScript conversion branch. Items in "Worth revisiting later" are likely valid but would change runtime behaviour or config surface, so they are kept out of the conversion cleanup unless explicitly requested.

## Already fixed

- `js/modules/base64.ts`: `decodebytes()` now passes `"decodebytes"` to `pyCheckArgs()` so validation errors report the correct function name.
- `js/PyDefUtils/python-utils.ts`: the module loader comment now says dotted module names are supported by parent/submodule attachment.
- `js/@Sk/index.ts`: `pyWrapperDescriptorConstructor` now returns `pyWrapperDescriptor` instead of `pyGetSetDescriptor`, with a narrower wrapper function type.
- `scripts/typecheck-full-metrics.mjs`: spawn failures are now thrown before parsing output.
- `TYPING_BACKLOG.md`: clarified that `27` was the initial candidate count and that no small module shims remain to prioritize.

## Worth revisiting later

- `runtime/client/tsconfig.json`
    - `compilerOptions.types` intentionally restricts ambient types to `jquery`, `plotly.js`, and `youtube`.
    - The matching packages are present in `runtime/client/package.json`.
    - Relaxing this may be reasonable later, but it changes the project type surface and should be checked as a config task.

- `platform/runtime-client/tsconfig.json`
    - `types: ["jquery", "web"]` is suspicious because DOM types normally come from `lib`.
    - Changing this affects both platform/runtime-client and shared runtime-client includes, so it should be handled separately from this cleanup.

- `js/PyDefUtils/map-overlays.ts`
    - `mapGetter()` only handles function-valued Google Maps overlay properties.
    - Returning direct properties would be useful but changes observable getter behaviour.

- `js/PyDefUtils/serialization.ts`
    - Several suggestions are plausible hardening:
        - validate `dict.items` before calling it in `setAttrsFromDict()`
        - validate tuple shape before reading `pyData.v[0].v`
        - explicitly stringify `pyClsName` before building `pyMaxKey`
        - handle `pyMyId.v` as `bigint` or `number`
    - These touch serialization behaviour and should get focused tests before changing.

- `js/modules/xml.ts`
    - Empty jQuery collections can throw in `tag_name`, `find_in_ns`, and `serialize`.
    - Returning empty strings/lists or throwing clearer errors would be behaviour work.

- `js/PyDefUtils/jquery-compat.ts`
    - `async = binaryOptions.async || true` ignores explicit `false`.
    - The custom transport also does not surface error/timeout callbacks and `abort()` does not abort the real XHR.
    - These are real transport behaviour changes and should be tested separately.

- `js/modules/regex.ts`
    - Invalid regex patterns currently surface raw `RegExp` errors.
    - Wrapping with a clearer Python-facing error is behaviour work.

- `js/PyDefUtils/designer.ts`
    - Height-handle code assumes `componentSpec` and numeric height values are present.
    - Guarding this would change designer failure modes.

- `js/PyDefUtils/media.ts`
    - `content_type` is assumed present when building blobs.
    - A fallback MIME type would be behaviour work and should be validated against Media semantics.

- `js/modules/image.ts`
    - `dataURItoBlob()` always returns `image/jpeg` even when the source data URL has another MIME type.
    - Thumbnail/rotate image load paths also lack `onerror` rejection, and one thumbnail security error message still says "rotate".
    - These are worthwhile image-module fixes, but they alter user-visible behaviour/errors.

- `js/modules/base64.ts`
    - `encodebytes`/`encodestring` are aliases of `b64encode()` and do not insert MIME newlines every 76 characters.
    - This predates the current bug fix and should be reviewed as API compatibility work.

- `js/modules/tz.ts`
    - `tzoffset` error text says "precisely one" keyword although zero keywords are accepted.
    - `tzutc` is built with class name `"tzlocal"`.
    - Both are small, but visible to users via errors/type names, so defer unless we choose to take behaviour-visible cleanup.
