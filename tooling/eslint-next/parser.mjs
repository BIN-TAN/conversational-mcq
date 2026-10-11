// ESM form of the eslint-config-next 15.5.24 parser wrapper; see LICENSE.md.
import babelParser from "next/dist/compiled/babel/eslint-parser.js";
import upstreamPackage from "./upstream-package.json" with { type: "json" };

export const { parse, parseForESLint } = babelParser;
export const meta = {
  name: "eslint-config-next/parser",
  version: upstreamPackage.version
};
