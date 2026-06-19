import { cleanupExpiredExports } from "../src/lib/services/master-export/storage";

async function main() {
  const result = await cleanupExpiredExports();
  console.log(`Expired export jobs: ${result.expired_jobs}`);
  console.log(`Deleted export files: ${result.deleted_files}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
