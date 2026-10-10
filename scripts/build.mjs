import { build, context } from 'esbuild';
import { cp, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outdir = resolve(root, 'dist');

const options = {
  entryPoints: [
    resolve(root, 'src/content.js'),         // isolated world：浮動按鈕與面板
    resolve(root, 'src/library/library.js'), // 擴充功能自己的音樂庫頁面（iframe）
  ],
  bundle: true,
  format: 'iife',
  target: 'chrome111',
  outdir,
  entryNames: '[name]',                      // → dist/content.js、dist/library.js
  legalComments: 'none',
};

// manifest.json / player.css / library.html 直接複製，dist/ 就是可載入的未封裝套件
async function copyStatic() {
  await mkdir(outdir, { recursive: true });
  for (const file of ['manifest.json', 'player.css', 'library.html']) {
    await cp(resolve(root, file), resolve(outdir, file));
  }
}

if (process.argv.includes('--watch')) {
  const ctx = await context(options);
  await copyStatic();
  await ctx.watch();
  console.log('watching src/ → dist/');
} else {
  await build(options);
  await copyStatic();
  console.log('built → dist/');
}
