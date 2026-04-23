import { parseFileZillaXml } from '../config/fileZillaImporter';

const SFTP_PROTOCOL = 1;
const FTP_PROTOCOL = 0;

function wrapInFileZilla(serversInner: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<FileZilla3>
  <Servers>
    ${serversInner}
  </Servers>
</FileZilla3>`;
}

function makeServer(overrides: {
  name?: string;
  host?: string;
  port?: string | number;
  protocol?: number;
  user?: string;
  pass?: string;
  passEncoding?: string;
  remoteDir?: string;
}): string {
  const {
    name = 'Test Server',
    host = 'sftp.example.com',
    port,
    protocol = SFTP_PROTOCOL,
    user = 'testuser',
    pass,
    passEncoding = 'base64',
    remoteDir,
  } = overrides;

  const portTag = port !== undefined ? `<Port>${port}</Port>` : '';
  const passTag = pass !== undefined
    ? `<Pass encoding="${passEncoding}">${pass}</Pass>`
    : '';
  const remoteDirTag = remoteDir !== undefined ? `<RemoteDir>${remoteDir}</RemoteDir>` : '';

  return `<Server>
    <Name>${name}</Name>
    <Host>${host}</Host>
    ${portTag}
    <Protocol>${protocol}</Protocol>
    <User>${user}</User>
    ${passTag}
    ${remoteDirTag}
  </Server>`;
}

describe('parseFileZillaXml — SFTP filtering', () => {
  it('imports SFTP entries (Protocol=1)', () => {
    const xml = wrapInFileZilla(makeServer({ protocol: SFTP_PROTOCOL }));
    const result = parseFileZillaXml(xml);
    expect(result.presets).toHaveLength(1);
    expect(result.skipped).toBe(0);
  });

  it('skips non-SFTP entries (Protocol=0)', () => {
    const xml = wrapInFileZilla(makeServer({ protocol: FTP_PROTOCOL }));
    const result = parseFileZillaXml(xml);
    expect(result.presets).toHaveLength(0);
  });

  it('handles mixed protocols — only SFTP ones imported', () => {
    const xml = wrapInFileZilla(
      makeServer({ name: 'FTP Site', protocol: FTP_PROTOCOL }) +
      makeServer({ name: 'SFTP Site', host: 'sftp2.example.com', protocol: SFTP_PROTOCOL })
    );
    const result = parseFileZillaXml(xml);
    expect(result.presets).toHaveLength(1);
    expect(result.presets[0].name).toBe('SFTP Site');
  });
});

describe('parseFileZillaXml — password decoding', () => {
  it('decodes base64 password correctly', () => {
    // 'testpass' in base64 = 'dGVzdHBhc3M='
    const xml = wrapInFileZilla(makeServer({ pass: 'dGVzdHBhc3M=', passEncoding: 'base64' }));
    const result = parseFileZillaXml(xml);
    expect(result.presets[0].password).toBe('testpass');
  });

  it('returns undefined password when no Pass element', () => {
    const xml = wrapInFileZilla(makeServer({ pass: undefined }));
    const result = parseFileZillaXml(xml);
    expect(result.presets[0].password).toBeUndefined();
  });
});

describe('parseFileZillaXml — field mapping', () => {
  it('maps host, port, username correctly', () => {
    const xml = wrapInFileZilla(
      makeServer({ host: 'myhost.com', port: 2222, user: 'myuser' })
    );
    const result = parseFileZillaXml(xml);
    const preset = result.presets[0];
    expect(preset.host).toBe('myhost.com');
    expect(preset.port).toBe(2222);
    expect(preset.username).toBe('myuser');
  });

  it('defaults port to 22 when not specified', () => {
    const xml = wrapInFileZilla(makeServer({ port: undefined }));
    const result = parseFileZillaXml(xml);
    expect(result.presets[0].port).toBe(22);
  });

  it('defaults remoteDir to "/" when not specified', () => {
    const xml = wrapInFileZilla(makeServer({ remoteDir: undefined }));
    const result = parseFileZillaXml(xml);
    expect(result.presets[0].remoteDir).toBe('/');
  });

  it('uses provided remoteDir', () => {
    const xml = wrapInFileZilla(makeServer({ remoteDir: '/uploads/inbox' }));
    const result = parseFileZillaXml(xml);
    expect(result.presets[0].remoteDir).toBe('/uploads/inbox');
  });

  it('sets authType to password and readOnly to false', () => {
    const xml = wrapInFileZilla(makeServer({}));
    const result = parseFileZillaXml(xml);
    const preset = result.presets[0];
    expect(preset.authType).toBe('password');
    expect(preset.readOnly).toBe(false);
    expect(preset.savedPaths).toEqual([]);
    expect(preset.keyPath).toBe('');
  });
});

describe('parseFileZillaXml — duplicates and existingPresets', () => {
  it('counts duplicate fingerprint against existingPresets', () => {
    const xml = wrapInFileZilla(makeServer({ host: 'sftp.example.com', user: 'testuser' }));
    const existing = [
      {
        name: 'Existing',
        host: 'sftp.example.com',
        port: 22,
        username: 'testuser',
        remoteDir: '/',
        savedPaths: [],
        authType: 'password' as const,
        keyPath: '',
        readOnly: false,
      },
    ];
    const result = parseFileZillaXml(xml, existing);
    expect(result.presets).toHaveLength(0);
    expect(result.duplicates).toBe(1);
  });

  it('does not treat different ports as duplicates against existingPresets', () => {
    const xml = wrapInFileZilla(makeServer({ host: 'sftp.example.com', user: 'testuser', port: 2222 }));
    const existing = [
      {
        name: 'Existing',
        host: 'sftp.example.com',
        port: 22,
        username: 'testuser',
        remoteDir: '/',
        savedPaths: [],
        authType: 'password' as const,
        keyPath: '',
        readOnly: false,
      },
    ];

    const result = parseFileZillaXml(xml, existing);

    expect(result.presets).toHaveLength(1);
    expect(result.duplicates).toBe(0);
  });

  it('keeps same host and user when port differs', () => {
    const xml = wrapInFileZilla(
      makeServer({ name: 'Port 22', host: 'sftp.example.com', user: 'testuser', port: 22 }) +
      makeServer({ name: 'Port 2222', host: 'sftp.example.com', user: 'testuser', port: 2222 })
    );

    const result = parseFileZillaXml(xml);

    expect(result.presets).toHaveLength(2);
    expect(result.duplicates).toBe(0);
    expect(result.skipped).toBe(0);
  });

  it('keeps same host and user when remoteDir differs', () => {
    const xml = wrapInFileZilla(
      makeServer({ name: 'Root Dir', host: 'sftp.example.com', user: 'testuser', remoteDir: '/' }) +
      makeServer({ name: 'Uploads Dir', host: 'sftp.example.com', user: 'testuser', remoteDir: '/uploads' })
    );

    const result = parseFileZillaXml(xml);

    expect(result.presets).toHaveLength(2);
    expect(result.duplicates).toBe(0);
    expect(result.skipped).toBe(0);
  });

  it('skips duplicate server names from the same import batch', () => {
    const xml = wrapInFileZilla(
      makeServer({ name: 'Same Name', host: 'alpha.example.com', user: 'alpha' }) +
      makeServer({ name: 'Same Name', host: 'beta.example.com', user: 'beta' })
    );
    const result = parseFileZillaXml(xml);
    expect(result.presets).toHaveLength(1);
    expect(result.presets[0].host).toBe('alpha.example.com');
    expect(result.skipped).toBe(1);
    expect(result.duplicates).toBe(0);
  });

  it('returns empty result for invalid/empty XML', () => {
    const result = parseFileZillaXml('<NotFileZilla></NotFileZilla>');
    expect(result.presets).toHaveLength(0);
    expect(result.skipped).toBe(0);
    expect(result.duplicates).toBe(0);
  });

  it('counts unnamed SFTP servers as skipped entries', () => {
    const xml = wrapInFileZilla(
      makeServer({ name: '', host: 'unnamed.example.com', user: 'anon' }) +
      makeServer({ name: 'Valid Site', host: 'valid.example.com', user: 'valid' })
    );

    const result = parseFileZillaXml(xml);

    expect(result.presets).toHaveLength(1);
    expect(result.presets[0].name).toBe('Valid Site');
    expect(result.skipped).toBe(1);
    expect(result.duplicates).toBe(0);
  });

  it('counts unnamed SFTP servers in the total processed batch', () => {
    const xml = wrapInFileZilla(
      makeServer({ name: '', host: 'unnamed.example.com', user: 'anon' }) +
      makeServer({ name: 'Duplicate Existing', host: 'dup.example.com', user: 'dup' }) +
      makeServer({ name: 'Imported Site', host: 'import.example.com', user: 'import' })
    );
    const existing = [
      {
        name: 'Existing',
        host: 'dup.example.com',
        port: 22,
        username: 'dup',
        remoteDir: '/',
        savedPaths: [],
        authType: 'password' as const,
        keyPath: '',
        readOnly: false,
      },
    ];

    const result = parseFileZillaXml(xml, existing);

    expect(result.presets).toHaveLength(1);
    expect(result.skipped).toBe(1);
    expect(result.duplicates).toBe(1);
    expect(result.presets.length + result.skipped + result.duplicates).toBe(3);
  });
});

describe('parseFileZillaXml — container traversal', () => {
  it('imports servers nested inside FileZilla folders', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<FileZilla3>
  <Servers>
    <Folder>
      <Name>Outer</Name>
      <Folder>
        <Name>Inner</Name>
        ${makeServer({ name: 'Nested SFTP', host: 'nested.example.com', user: 'nested' })}
      </Folder>
    </Folder>
  </Servers>
</FileZilla3>`;

    const result = parseFileZillaXml(xml);
    expect(result.presets).toHaveLength(1);
    expect(result.presets[0].name).toBe('Nested SFTP');
    expect(result.presets[0].host).toBe('nested.example.com');
  });

  it('parses a root-level <Servers> container without FileZilla3 wrapper', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Servers>
  ${makeServer({ name: 'Root Servers', host: 'root.example.com', user: 'root' })}
</Servers>`;

    const result = parseFileZillaXml(xml);
    expect(result.presets).toHaveLength(1);
    expect(result.presets[0].name).toBe('Root Servers');
  });
});
