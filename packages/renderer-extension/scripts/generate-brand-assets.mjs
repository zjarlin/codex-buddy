import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

const packageRoot = path.resolve(import.meta.dirname, "..");
const assetsRoot = path.join(packageRoot, "src/assets");
const launcherRoot = path.resolve(packageRoot, "../../crates/launcher/assets");
const mark = await readFile(path.join(assetsRoot, "codexhost-mark.svg"), "utf8");

// 矢量字标是唯一设计源；桌面底板与透明字标均由同一轮廓生成。
const appIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <rect x="80" y="80" width="864" height="864" rx="196" fill="white" stroke="black" stroke-opacity=".08" stroke-width="2"/>
  <svg x="128" y="128" width="768" height="768">${mark}</svg>
</svg>`;
const browser = await chromium.launch();

try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });

  async function render(svg, size, background = "transparent") {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<style>html,body{margin:0;width:100%;height:100%;background:${background}}svg{display:block;width:100%;height:100%}</style>${svg}`,
    );
    return page.screenshot({ omitBackground: true });
  }

  const icon = await render(appIcon, 1024);
  await writeFile(path.join(launcherRoot, "codexhost.png"), icon);
  await writeFile(path.join(assetsRoot, "codexhost-icon.png"), icon);
  await writeFile(
    path.join(assetsRoot, "codexhost-logo-transparent.png"),
    await render(mark, 1024),
  );
  await writeFile(path.join(assetsRoot, "codexhost-logo.png"), await render(mark, 1024, "white"));

  // ICO 使用各尺寸独立栅格化的 PNG 帧，避免小图标多次缩放造成模糊。
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const frames = [];
  for (const size of sizes) {
    frames.push(await render(appIcon, size));
  }
  const directory = Buffer.alloc(6 + sizes.length * 16);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(sizes.length, 4);
  let offset = directory.length;
  for (const [index, size] of sizes.entries()) {
    const entry = 6 + index * 16;
    directory[entry] = size % 256;
    directory[entry + 1] = size % 256;
    directory.writeUInt16LE(1, entry + 4);
    directory.writeUInt16LE(32, entry + 6);
    directory.writeUInt32LE(frames[index].length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += frames[index].length;
  }
  await writeFile(path.join(launcherRoot, "codexhost.ico"), Buffer.concat([directory, ...frames]));
  console.log("Generated CodexBuddy PNG and ICO assets from codexhost-mark.svg");
} finally {
  await browser.close();
}
