import { copyFile } from 'node:fs/promises';

await copyFile(
  new URL('../assets/icon-source.png', import.meta.url),
  new URL('../assets/icon.png', import.meta.url)
);
