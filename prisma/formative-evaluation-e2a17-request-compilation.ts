import {
  compileE2A17RequestsNoNetwork
} from "@/lib/evaluation/formative/e2a17-bounded-student-simulator-canary";

const result = compileE2A17RequestsNoNetwork();
console.log(JSON.stringify(result, null, 2));
if (!result.passed) process.exitCode = 1;
