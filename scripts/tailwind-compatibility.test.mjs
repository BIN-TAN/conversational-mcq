import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stylesheet = resolve(root, "src/app/globals.css");
const result = await postcss([tailwind({ optimize: false })]).process(
  await readFile(stylesheet, "utf8"),
  { from: stylesheet }
);
const compiled = postcss.parse(result.css);
const normalize = (value) => value.replace(/\s+/g, " ").trim();

function rules(selector) {
  const found = [];
  compiled.walkRules((rule) => {
    if (normalize(rule.selector) === normalize(selector)) found.push(rule);
  });
  return found;
}

function declaration(selector, property) {
  const matching = rules(selector).flatMap((rule) => rule.nodes.filter(
    (node) => node.type === "decl" && node.prop === property
  ));
  assert.ok(matching.length, `Missing ${selector} { ${property} }`);
  return matching.at(-1).value;
}

test("the v4 compiler retains application and status colors", () => {
  assert.deepEqual(result.warnings(), []);
  assert.equal(declaration(".bg-ualberta-green", "background-color"), "#007C41");
  assert.equal(declaration(".text-ink", "color"), "#202426");
  assert.equal(declaration(".border-line", "border-color"), "#D7DDD9");
  assert.equal(declaration(".bg-blue-50", "background-color"), "#eff6ff");
  assert.equal(declaration(".text-amber-800", "color"), "#92400e");
});

test("type, radius and chat shadows preserve the v3 measurements", () => {
  assert.equal(declaration(".text-sm", "font-size"), "0.875rem");
  assert.equal(declaration(".text-sm", "line-height"), "var(--tw-leading, 1.25rem)");
  assert.equal(declaration(".rounded", "border-radius"), "0.25rem");
  assert.equal(declaration(".rounded-md", "border-radius"), "0.375rem");
  assert.equal(declaration(".rounded-full", "border-radius"), "9999px");
  assert.match(declaration(".shadow-sm", "--tw-shadow"), /^0 1px 2px 0 /);
  assert.match(declaration(".shadow-sm", "--tw-shadow"), /rgb\(0 0 0 \/ 0\.05\)/);
  assert.match(declaration(".shadow-soft", "--tw-shadow"), /^0 8px 22px /);
});

test("stacked content and table dividers retain visible-sibling semantics", () => {
  const space = ".space-y-4 > :not([hidden]) ~ :not([hidden])";
  assert.equal(declaration(space, "margin-top"), "calc(1rem * calc(1 - var(--tw-space-y-reverse)))");
  assert.equal(declaration(space, "margin-bottom"), "calc(1rem * var(--tw-space-y-reverse))");
  assert.equal(declaration(".divide-y > :not([hidden]) ~ :not([hidden])", "border-top-width"),
    "calc(1px * calc(1 - var(--tw-divide-y-reverse)))");
  assert.match(declaration(".divide-line > :not([hidden]) ~ :not([hidden])", "border-color"),
    /^rgb\(215 221 217 /);
  assert.equal(rules(".space-y-4").length, 0, "Do not also emit v4 last-child spacing");
  assert.equal(rules(".divide-y").length, 0, "Do not also emit v4 last-child dividers");
});

test("Preflight retains the existing font, placeholder and button defaults", () => {
  assert.equal(declaration("html, :host", "font-family"),
    'ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"');
  assert.equal(declaration("input::placeholder, textarea::placeholder", "color"), "#9ca3af");
  assert.equal(declaration('button, [role="button"]', "cursor"), "pointer");
});

test("keyboard focus and forced-colors outlines retain their existing precedence", () => {
  for (const selector of [".outline-none", ".focus\\:outline-none:focus", ".focus-visible\\:outline-none:focus-visible"]) {
    assert.equal(declaration(selector, "outline"), "2px solid transparent");
    assert.equal(declaration(selector, "outline-offset"), "2px");
  }
  assert.equal(declaration(":focus-visible", "outline"), "3px solid var(--ualberta-gold)");
  const focusRule = rules(":focus-visible").at(-1);
  assert.equal(focusRule.parent.name, "layer");
  assert.equal(focusRule.parent.params, "utilities");
  for (const rule of rules("a")) {
    assert.equal(rule.parent.params, "base", "Global anchor defaults must not override color utilities");
  }
});
