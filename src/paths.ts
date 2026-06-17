import { isAbsolute, join, relative, resolve } from "node:path";

export function assertReadableRemotePath(path: string): void {
  if (!path.startsWith("/")) {
    throw new Error(`Baidu remote path must be absolute and start with "/": ${path}`);
  }
}

export function assertWritableRemotePath(
  path: string,
  strictAppPaths: boolean
): void {
  assertReadableRemotePath(path);
  if (strictAppPaths && !path.startsWith("/apps/")) {
    throw new Error(
      `Baidu write paths must be under /apps/<appName> when strict app paths are enabled: ${path}`
    );
  }
}

export function resolveLocalPath(inputPath: string, localRoot: string): string {
  const root = resolve(localRoot);
  const target = isAbsolute(inputPath)
    ? resolve(inputPath)
    : resolve(join(root, inputPath));

  const rel = relative(root, target);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
    return target;
  }

  throw new Error(`Refusing to access path outside local root: ${inputPath}`);
}
