#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptRoot = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptRoot, "../..");
const sourceLogo = join(projectRoot, "resources", "icons", "MyDSH.png");
const outputRoot = join(projectRoot, "resources", "icons");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: "inherit",
    ...options,
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} failed with ${String(result.status ?? result.signal)}`,
    );
  }
}

function resizePng(source, destination, size) {
  const script = [
    "Add-Type -AssemblyName System.Drawing",
    "$sourcePath=$env:FIREFLY_ICON_SOURCE",
    "$destinationPath=$env:FIREFLY_ICON_DESTINATION",
    "$size=[int]$env:FIREFLY_ICON_SIZE",
    "$source=[System.Drawing.Image]::FromFile($sourcePath)",
    "$bitmap=[System.Drawing.Bitmap]::new($size,$size,[System.Drawing.Imaging.PixelFormat]::Format32bppArgb)",
    "$graphics=[System.Drawing.Graphics]::FromImage($bitmap)",
    "$graphics.Clear([System.Drawing.Color]::Transparent)",
    "$graphics.CompositingQuality=[System.Drawing.Drawing2D.CompositingQuality]::HighQuality",
    "$graphics.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic",
    "$graphics.SmoothingMode=[System.Drawing.Drawing2D.SmoothingMode]::HighQuality",
    "$graphics.DrawImage($source,0,0,$size,$size)",
    "$bitmap.Save($destinationPath,[System.Drawing.Imaging.ImageFormat]::Png)",
    "$graphics.Dispose(); $bitmap.Dispose(); $source.Dispose()",
  ].join("; ");
  run("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    script,
  ], {
    env: {
      ...process.env,
      FIREFLY_ICON_SOURCE: source,
      FIREFLY_ICON_DESTINATION: destination,
      FIREFLY_ICON_SIZE: String(size),
    },
  });
}

async function writeWindowsIcon(pngs, destination) {
  const images = await Promise.all(
    pngs.map(async ({ size, path }) => ({
      size,
      data: await readFile(path),
    })),
  );
  const headerSize = 6;
  const entrySize = 16;
  let imageOffset = headerSize + entrySize * images.length;
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  const entries = images.map(({ size, data }) => {
    const entry = Buffer.alloc(entrySize);
    entry.writeUInt8(size === 256 ? 0 : size, 0);
    entry.writeUInt8(size === 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(imageOffset, 12);
    imageOffset += data.length;
    return entry;
  });

  await writeFile(
    destination,
    Buffer.concat([header, ...entries, ...images.map(({ data }) => data)]),
  );
}

async function main() {
  if (process.platform !== "win32" || process.arch !== "x64") {
    throw new Error("icon generation requires Windows x64");
  }

  await mkdir(outputRoot, { recursive: true });
  const temporaryRoot = await mkdtemp(join(tmpdir(), "minke-icons-"));

  try {
    resizePng(sourceLogo, join(outputRoot, "icon.png"), 512);

    const windowsSizes = [16, 20, 24, 32, 40, 48, 64, 256];
    const windowsPngs = windowsSizes.map((size) => ({
      size,
      path: join(temporaryRoot, `windows-${size}.png`),
    }));
    for (const { size, path } of windowsPngs) {
      resizePng(sourceLogo, path, size);
    }
    await writeWindowsIcon(windowsPngs, join(outputRoot, "icon.ico"));

  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

await main();
