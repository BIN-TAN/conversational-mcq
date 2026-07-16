import { writeApplicationBuildInfoArtifact } from "../src/lib/provenance/application-build-info";

const written = writeApplicationBuildInfoArtifact();

console.log(
  JSON.stringify(
    {
      status: "written",
      output_path: written.output_path,
      application_git_commit: written.application_git_commit,
      application_git_commit_source: written.application_git_commit_source,
      application_build_timestamp: written.application_build_timestamp,
      resolver_version: written.resolver_version
    },
    null,
    2
  )
);
