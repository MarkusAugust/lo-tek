/**
 * What a generator would write now against what is on the disk, asked one
 * way by the checks that hold a generated file to its generator.
 */

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

/** A line for every file that is missing or is not what the generator gives. */
export function outOfDate(
  root: string,
  files: Record<string, string>,
): string[] {
  return Object.entries(files).flatMap(([path, content]) => {
    const file = join(root, path)
    if (!existsSync(file)) return [`${path} is missing`]
    return readFileSync(file, "utf8") === content
      ? []
      : [`${path} is out of date`]
  })
}
