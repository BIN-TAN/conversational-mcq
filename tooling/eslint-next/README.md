# Next.js ESLint rules: transparent local copy

This directory retains the complete published `@next/eslint-plugin-next@15.5.24`
runtime and type declarations (21 rules; 52 files). The upstream MIT license is
included. `upstream-package.json` is provenance metadata, not an installed package
or an alias. No npm package is renamed or hidden from the dependency audit.

The original plugin depended on `fast-glob`, whose `micromatch` dependency reaches
the unpatched `braces` advisory [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
The only changed upstream runtime file is `dist/utils/get-root-dirs.js`. It imports
the real `tinyglobby` package directly and uses `globSync` with
`onlyDirectories: true`, `expandDirectories: false`, and an explicit absolute-output
option for absolute input paths. The other rule and utility files are unchanged.
Literal roots use a directory stat check, avoiding tinyglobby's empty-pattern
error for the current working directory; directory results omit extra trailing
separators while preserving filesystem roots.
`provenance.json` records upstream and delivered SHA-256 values for every file,
the original npm tarball integrity, the source tag and the declared modification.
The local `.gitattributes` keeps these audited files in LF form on both Windows
and Linux; hashes are checked on the actual bytes without newline normalization.

`base-config.cjs` and `parser.mjs` preserve the configuration and parser wrapper
from `eslint-config-next@15.5.24`. The obsolete module-resolution monkey patches
are omitted because the React, hooks, accessibility, import and TypeScript plugins
and import resolvers are explicit project development dependencies. The Next rules
are added through the upstream plugin's native flat `coreWebVitals` configuration.
The existing TypeScript recommended configuration and two warning overrides are
applied in their original order. The parser wrapper uses named ESM exports and
the Node 22 runtime already used by this project. The project still uses ESLint's `FlatCompat` for
the other upstream configurations rather than approximating their rules.

`upstream-effective-config.json` was captured using ESLint before changing the
original repository config or removing `eslint-config-next`. It contains hashes
of those source files and the effective rules, parser metadata/options, globals,
settings and linter options for JavaScript, TypeScript, TSX, MJS and CJS. A null JSX
entry records that JSX-only files were already unmatched by the original config.
Only generated/private artifacts and the copied third-party runtime are newly
ignored; project source and the adapter's tests remain checked.

Run `node --test scripts/eslint-next-vendor.test.mjs` from the project root. It
compares the complete effective configuration with the saved upstream baseline,
checks all source hashes and rule names, executes representative Next rules, and
checks directory matching using disposable synthetic fixtures. The default project
root and ordinary relative/absolute glob roots are covered, including Windows
separators. The adapter does not promise compatibility with zero-padded or stepped
brace ranges; `tinyglobby` documents those differences, and this project's config
does not use them. These checks do not access the database or student records.

For maintenance, review upstream releases explicitly. Obtain the published plugin
tarball from the URL and integrity in `provenance.json`, compare the rules, and
reapply the narrow adapter only if still necessary. Keep the MIT notice and update
the recorded hashes and tests. If upstream removes the vulnerable chain, prefer
returning to the official package after equivalent lint verification. Do not
silently regenerate the expected configuration from the new implementation.

Official references:

- [Next.js plugin source at v15.5.24](https://github.com/vercel/next.js/tree/v15.5.24/packages/eslint-plugin-next)
- [Next.js lint configuration at v15.5.24](https://github.com/vercel/next.js/tree/v15.5.24/packages/eslint-config-next)
- [MIT license at v15.5.24](https://raw.githubusercontent.com/vercel/next.js/v15.5.24/license.md)
- [tinyglobby migration differences](https://superchupu.dev/tinyglobby/comparison)
