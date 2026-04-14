import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import * as yauzl from 'yauzl';
import { buildZip } from '../sftp/zipBuilder';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sftp-zip-test-'));
const createdZips: string[] = [];

afterAll(() => {
  for (const p of createdZips) {
    try { fs.unlinkSync(p); } catch { /* ignore */ }
  }
  try { fs.rmdirSync(tmpDir); } catch { /* ignore */ }
});

function makeTempFile(name: string, content = 'hello'): string {
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, content);
  return p;
}

function readZipEntries(zipPath: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err: Error | null, zip: yauzl.ZipFile | null) => {
      if (err || !zip) { return reject(err ?? new Error('no zip')); }
      const names: string[] = [];
      zip.readEntry();
      zip.on('entry', (entry: yauzl.Entry) => {
        names.push(entry.fileName);
        zip.readEntry();
      });
      zip.on('end', () => resolve(names));
      zip.on('error', reject);
    });
  });
}

describe('buildZip', () => {
  it('resolves with a path matching the filename pattern', async () => {
    const f1 = makeTempFile('invoice.xml');
    const anchor = makeTempFile('anchor.xml');
    const zipPath = await buildZip([f1], anchor, 'bundle');
    createdZips.push(zipPath);
    expect(path.basename(zipPath)).toMatch(/^bundle_\d{8}T\d{6}\.zip$/);
  });

  it('produces a readable file with ZIP magic bytes', async () => {
    const f1 = makeTempFile('doc.xml', '<root/>');
    const anchor = makeTempFile('anchor2.xml');
    const zipPath = await buildZip([f1], anchor, 'test');
    createdZips.push(zipPath);

    const buf = Buffer.alloc(4);
    const fd = fs.openSync(zipPath, 'r');
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);

    expect(buf[0]).toBe(0x50); // P
    expect(buf[1]).toBe(0x4b); // K
    expect(buf[2]).toBe(0x03);
    expect(buf[3]).toBe(0x04);
  });

  it('zip is placed in the same directory as the anchor file', async () => {
    const f1 = makeTempFile('file1.xml');
    const anchor = makeTempFile('anchor3.xml');
    const zipPath = await buildZip([f1], anchor, 'loc');
    createdZips.push(zipPath);
    expect(path.dirname(zipPath)).toBe(tmpDir);
  });

  it('contains only basenames — no directory prefix', async () => {
    const f1 = makeTempFile('alpha.xml', 'aaa');
    const f2 = makeTempFile('beta.xml', 'bbb');
    const anchor = makeTempFile('anchor4.xml');
    const zipPath = await buildZip([f1, f2], anchor, 'multi');
    createdZips.push(zipPath);

    const entries = await readZipEntries(zipPath);
    expect(entries).toContain('alpha.xml');
    expect(entries).toContain('beta.xml');
    for (const e of entries) {
      expect(e).not.toContain('/');
      expect(e).not.toContain('\\');
    }
  });

  it('all provided files appear in the archive', async () => {
    const files = ['x.xml', 'y.xml', 'z.xml'].map(n => makeTempFile(n, n));
    const anchor = makeTempFile('anchor5.xml');
    const zipPath = await buildZip(files, anchor, 'all');
    createdZips.push(zipPath);

    const entries = await readZipEntries(zipPath);
    expect(entries).toContain('x.xml');
    expect(entries).toContain('y.xml');
    expect(entries).toContain('z.xml');
  });
});
