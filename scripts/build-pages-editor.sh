#!/bin/sh
set -eu
# Only build tooling: the resulting browser module is self-contained and
# served by ChatX. Never fetch a CDN from the end-user browser.
npm install --no-save --package-lock=false --ignore-scripts --no-audit --no-fund \
  @tiptap/core@3 @tiptap/starter-kit@3 @tiptap/extension-underline@3 \
  @tiptap/extension-link@3 esbuild@0.25.12
./node_modules/.bin/esbuild public/wiki-editor.js \
  --bundle --format=esm --platform=browser \
  --outfile=public/wiki-editor.bundle.js
test -s public/wiki-editor.bundle.js
