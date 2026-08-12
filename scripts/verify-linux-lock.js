import { readFile } from 'node:fs/promises';

const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
const linuxCanvas = lock.packages?.['node_modules/@napi-rs/canvas-linux-x64-gnu'];

if (
  linuxCanvas?.version !== '0.1.80'
  || linuxCanvas?.optional !== true
  || !Array.isArray(linuxCanvas.os)
  || !linuxCanvas.os.includes('linux')
  || !Array.isArray(linuxCanvas.cpu)
  || !linuxCanvas.cpu.includes('x64')
) {
  throw new Error('package-lock.json is missing @napi-rs/canvas-linux-x64-gnu@0.1.80');
}

console.log('Verified Linux PDF canvas dependency in package-lock.json.');
