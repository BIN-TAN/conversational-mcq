import assert from "node:assert/strict";
import test from "node:test";
import config from "../next.config.mjs";

test("production compiler cache is disabled without replacing optimization or plugins", () => {
  for (const nextRuntime of [undefined, "nodejs", "edge"]) {
    const optimization = { minimize: true, splitChunks: { chunks: "all" } };
    const plugins = [{ name: "retained-next-plugin" }];
    const incoming = { cache: { type: "filesystem", cacheDirectory: "/preserved-cache" }, optimization, plugins };
    const result = config.webpack(incoming, { dev: false, isServer: nextRuntime !== undefined, nextRuntime });
    assert.equal(result, incoming);
    assert.equal(result.cache, false);
    assert.equal(result.optimization, optimization);
    assert.equal(result.plugins, plugins);
    assert.equal(result.optimization.minimize, true);
  }
});

test("development keeps the supplied cache and compiler settings unchanged", () => {
  for (const cache of [false, { type: "memory" }, { type: "filesystem", maxMemoryGenerations: 0 }]) {
    const incoming = { cache, optimization: { minimize: false }, plugins: [] };
    const before = structuredClone(incoming);
    assert.equal(config.webpack(incoming, { dev: true }), incoming);
    assert.equal(incoming.cache, cache);
    assert.deepEqual(incoming, before);
  }
});

test("custom callback keeps the separate build worker, memory optimization and validation", () => {
  assert.equal(config.experimental.webpackBuildWorker, true);
  assert.equal(config.experimental.webpackMemoryOptimizations, true);
  assert.notEqual(config.typescript?.ignoreBuildErrors, true);
  assert.notEqual(config.eslint?.ignoreDuringBuilds, true);
  assert.equal(config.reactStrictMode, true);
});
