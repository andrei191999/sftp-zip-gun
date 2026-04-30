import * as path from 'path';
import * as fs from 'fs';
import archiver from 'archiver';

export function formatTimestamp(date: Date): string {
  const year = date.getFullYear().toString();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const seconds = date.getSeconds().toString().padStart(2, '0');
  return `${year}${month}${day}T${hours}${minutes}${seconds}`;
}

export function buildZip(
  files: string[],
  anchorFile: string,
  baseName: string,
  onProgress?: (processed: number, total: number) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const zipName = `${baseName}.zip`;
    const outPath = path.join(path.dirname(anchorFile), zipName);

    const output = fs.createWriteStream(outPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => resolve(outPath));
    archive.on('error', reject);

    if (onProgress) {
      archive.on('progress', (p: { entries: { total: number; processed: number } }) => {
        onProgress(p.entries.processed, p.entries.total);
      });
    }

    archive.pipe(output);
    for (const file of files) {
      archive.file(file, { name: path.basename(file) });
    }
    archive.finalize();
  });
}
