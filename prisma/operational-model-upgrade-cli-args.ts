export function argValue(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

export function candidateManifestArg() {
  return argValue("--manifest");
}
