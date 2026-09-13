#!/usr/bin/env node

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const command = process.argv[2];

if (command !== "package" && command !== "make") {
  throw new Error(`expected "package" or "make", received ${JSON.stringify(command)}`);
}

if (process.platform !== "win32" || process.arch !== "x64") {
  throw new Error(
    `MyDSH packaging requires win32-x64, received ${process.platform}-${process.arch}`,
  );
}

const { api } = await import("@electron-forge/core");
const options = {
  arch: "x64",
  dir: projectRoot,
  interactive: true,
  platform: "win32",
};

if (command === "package") {
  await api.package(options);
} else {
  await api.make(options);
}
