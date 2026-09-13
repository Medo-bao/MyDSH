interface ParsedVersion {
  core: number[];
  prerelease: string[];
}

export function compareReleaseVersions(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < Math.max(a.core.length, b.core.length); index += 1) {
    const difference = (a.core[index] ?? 0) - (b.core[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  if (a.prerelease.length === 0 && b.prerelease.length > 0) return 1;
  if (a.prerelease.length > 0 && b.prerelease.length === 0) return -1;
  for (
    let index = 0;
    index < Math.max(a.prerelease.length, b.prerelease.length);
    index += 1
  ) {
    const x = a.prerelease[index];
    const y = b.prerelease[index];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xNumeric = /^\d+$/u.test(x);
    const yNumeric = /^\d+$/u.test(y);
    if (xNumeric && yNumeric) {
      const difference = Number(x) - Number(y);
      if (difference !== 0) return Math.sign(difference);
    } else if (xNumeric !== yNumeric) {
      return xNumeric ? -1 : 1;
    } else {
      const difference = x.localeCompare(y);
      if (difference !== 0) return Math.sign(difference);
    }
  }
  return 0;
}

function parseVersion(value: string): ParsedVersion {
  const normalized = value.trim().replace(/^v/u, "").split("+", 1)[0] ?? "";
  const [coreValue = "", prereleaseValue] = normalized.split("-", 2);
  const core = coreValue.split(".").map((part) => {
    if (!/^\d+$/u.test(part)) return 0;
    return Number(part);
  });
  return {
    core,
    prerelease: prereleaseValue?.split(".") ?? [],
  };
}
