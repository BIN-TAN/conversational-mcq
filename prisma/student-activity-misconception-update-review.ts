import {
  buildNoLiveActivityMisconceptionEvidenceFixture
} from "../src/lib/services/student-assessment/activity-misconception-evidence";
import {
  writePostActivityMisconceptionUpdateReview
} from "../src/lib/services/student-assessment/activity-misconception-update";
import { prisma } from "../src/lib/db";
import { activityMisconceptionEvidenceFixtureCases } from "./student-activity-misconception-evidence-fixtures";

function getArg(name: string) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const sessionPublicId = getArg("session-public-id");
  const fallbackPackets = sessionPublicId
    ? []
    : activityMisconceptionEvidenceFixtureCases()
      .slice(0, 6)
      .map((fixture) => buildNoLiveActivityMisconceptionEvidenceFixture(fixture));

  const summary = await writePostActivityMisconceptionUpdateReview({
    session_public_id: sessionPublicId,
    fallback_packets: fallbackPackets
  });

  console.log(JSON.stringify(summary, null, 2));
  if (summary.status === "failed") {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
