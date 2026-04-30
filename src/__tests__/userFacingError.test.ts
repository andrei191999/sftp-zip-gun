import { sanitizeKeyFileReadError, sanitizeUserFacingError } from '../errors/userFacingError';

describe('sanitizeUserFacingError', () => {
  it('replaces key-file read errors with a safe message', () => {
    expect(
      sanitizeUserFacingError(`Cannot read key file "C:\\Users\\user\\.ssh\\id_ed25519": ENOENT: no such file or directory, open 'C:\\Users\\user\\.ssh\\id_ed25519'`)
    ).toBe(sanitizeKeyFileReadError());
  });

  it('replaces generic local filesystem errors with a safe message', () => {
    expect(
      sanitizeUserFacingError(`ENOENT: no such file or directory, open 'C:\\Workspace\\Scripts\\vs-code-extensions\\sftp-upload\\missing.xml'`)
    ).toBe('A required local file could not be read. Check the selected files, folders, or SSH key path and try again.');
  });

  it('leaves remote/authentication errors untouched', () => {
    expect(sanitizeUserFacingError('All configured authentication methods failed')).toBe(
      'All configured authentication methods failed'
    );
  });
});
