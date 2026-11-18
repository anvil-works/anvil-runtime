# @anvil-works/anvil-react

Build Anvil components with React, exposing properties, events and methods to Python and integrating with the designer.

## Prepared 1.1.6 release

Supports React/React DOM 18.x and 19.3.x or later in 19.x. Use matching React/React DOM versions and share their imports across the app and its dependencies. The bridge must also resolve to a single module instance.

Changes from 1.1.5:

- Declare React 19 peers while retaining React 18.
- Build declarations using React 19 types: initialize the DOM ref explicitly and use `React.JSX.Element`.
- Erase imports/exports used only as types, preventing package builds from pulling runtime implementation modules into the bridge bundle.
- Produce self-contained ESM entrypoints and declarations with tsup 8 and a standalone pnpm lockfile.
- Register `useSectionRefs` DOM regions when their refs attach and expose section metadata for ordinary components as well as containers, so list sections can be selected and edited.

No peer override is required. The private React example includes a prepared tarball until npm publication. This change does not publish the release.

## Build and pack

From this directory in the Anvil source checkout:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm pack --out /absolute/path/anvil-react-1.1.6.tgz
```

The nested workspace limits installation to this package. The build emits `index`, `designer` and `util` ESM entrypoints, their shared chunk, and declarations. Generated files are ignored in the source checkout and included in the packed package. Inspect the tarball before releasing.

The declaration build is the focused package check. A standalone `tsc --noEmit` also follows Anvil runtime implementation imports and currently encounters unrelated runtime JSX typing errors.

## Runner and designer compatibility checks

Use `anvil-works/react-theme-example` as the companion fixture. Run its same compiled assets against React/React DOM 19.3.0 and 18.3.1 import maps. Its five components exercise Python events/properties/methods, writeback, refs, app/scoped context and designer hooks through the actual Anvil runtime.

Before publishing, verify the example build and CLI validation. Exercise typing, focus, colour updates, calendar edits/clearing and context in both runner families. Edit designer regions/sections and drop an Anvil child into a closed preview; confirm saved `expanded` does not change. Use the example as a dependency in another app to check shared module instances and asset resolution.

For `useSectionRefs`, test a component without `container: true`: select and edit an initial section, add and edit another, then remove it. Confirm the remaining titles persist after reload and render in the runner. Sections must work without making the component a container.
