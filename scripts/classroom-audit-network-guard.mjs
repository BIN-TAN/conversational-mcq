import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";

// Audit tests may use local HTTP fixtures, never external services.
function assertLocal(target) {
  const hostname = typeof target === "string" || target instanceof URL
    ? new URL(target).hostname
    : target?.hostname ?? target?.host ?? "localhost";
  if (!["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname)) {
    throw new Error("classroom_audit_external_network_forbidden");
  }
}
const fetch = globalThis.fetch;
globalThis.fetch = (input, options) => {
  assertLocal(input instanceof Request ? input.url : input);
  return fetch(input, options);
};
for (const transport of [http, https]) {
  for (const name of ["request", "get"]) {
    const original = transport[name];
    transport[name] = function (target, ...args) {
      assertLocal(target);
      return original.call(this, target, ...args);
    };
  }
}
syncBuiltinESMExports();
