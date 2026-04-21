import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isEmptyDirectory(path) {
  return isDirectory(path) && readdirSync(path).length === 0;
}

function mergeDirectoryContents(source, target) {
  mkdirSync(target, { recursive: true });

  for (const entry of readdirSync(source)) {
    const sourcePath = join(source, entry);
    const targetPath = join(target, entry);

    if (!existsSync(targetPath)) {
      renameSync(sourcePath, targetPath);
      continue;
    }

    if (isDirectory(sourcePath) && isDirectory(targetPath)) {
      mergeDirectoryContents(sourcePath, targetPath);
      if (isEmptyDirectory(sourcePath)) {
        rmSync(sourcePath, { recursive: true, force: true });
      }
      continue;
    }

    rmSync(sourcePath, { recursive: true, force: true });
  }
}

function normalizeDuplicatedSibling(parent, name) {
  const original = join(parent, name);
  const duplicate = join(parent, `${name} 2`);

  if (!existsSync(duplicate)) {
    return;
  }

  if (isEmptyDirectory(original)) {
    rmSync(original, { recursive: true, force: true });
    renameSync(duplicate, original);
    return;
  }

  if (isDirectory(original) && isDirectory(duplicate)) {
    mergeDirectoryContents(duplicate, original);
    if (isEmptyDirectory(duplicate)) {
      rmSync(duplicate, { recursive: true, force: true });
    }
  }
}

for (const target of process.argv.slice(2)) {
  if (!target || target === "." || target === "/") {
    continue;
  }

  normalizeDuplicatedSibling(join(target, "server"), "chunks");
  normalizeDuplicatedSibling(join(target, "server"), "app");
  normalizeDuplicatedSibling(join(target, "static"), "css");
  normalizeDuplicatedSibling(join(target, "static"), "media");
  normalizeDuplicatedSibling(join(target, "static"), "chunks");
  normalizeDuplicatedSibling(join(target, "cache"), "webpack");
}
