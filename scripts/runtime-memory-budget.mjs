const MiB = 1024 * 1024;

// Build-time NODE_OPTIONS can exceed the shared runtime container's capacity.
// Reserve space for native allocations, buffers, the supervisor, and both V8s.
export function runtimeMemoryArguments(mode, constrainedBytes) {
  if (mode !== "start" || !Number.isFinite(constrainedBytes) || constrainedBytes < 256 * MiB) {
    return { web: [], worker: [] };
  }
  const capacityMiB = Math.floor(constrainedBytes / MiB);
  const semiSpaceMiB = capacityMiB <= 1024 ? 4 : 8;
  const flags = (fraction) => [
    `--max-old-space-size=${Math.floor(capacityMiB * fraction)}`,
    `--max-semi-space-size=${semiSpaceMiB}`
  ];
  return { web: flags(0.375), worker: flags(0.1875) };
}
