import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { resolve, sep } from "node:path";
import { AcceptanceIdentitySchema, evaluateClassroomAcceptance } from "../src/lib/evaluation/classroom-acceptance";

const [packetPath, identityPath, evidenceDirectory] = process.argv.slice(2);
if (!packetPath || !identityPath || !evidenceDirectory) {
  console.error("Usage: npm run classroom:acceptance:check -- packet.json current-identity.json evidence-directory");
  process.exitCode = 1;
} else {
  const root = realpathSync(evidenceDirectory);
  const result = evaluateClassroomAcceptance({
    packet: JSON.parse(readFileSync(packetPath, "utf8")),
    currentIdentity: AcceptanceIdentitySchema.parse(JSON.parse(readFileSync(identityPath, "utf8"))),
    artifactHash: path => {
      try {
        const file = realpathSync(resolve(root, path));
        if (!file.startsWith(root + sep)) return null;
        return createHash("sha256").update(readFileSync(file)).digest("hex");
      } catch { return null; }
    }
  });
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.status === "blocked" ? 1 : 0;
}
