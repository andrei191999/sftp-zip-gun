## ADDED Requirements

### Requirement: SFTP connection with password and key auth
`sftpClient` SHALL connect to a remote SFTP server using credentials from a `PresetMeta` object plus the resolved password or key passphrase. It MUST support `authType: 'password'` (username + password) and `authType: 'key'` (private key file path + optional passphrase). The client MUST expose `connect(preset, password?)`, `uploadFile(localPath, remotePath, onProgress)`, and `disconnect()` methods.

#### Scenario: Password auth connect succeeds
- **WHEN** `sftpClient.connect({ host, port, username, authType: 'password' }, 'correctpass')` is called
- **THEN** the method resolves without error and the client is in connected state

#### Scenario: Wrong password connect rejects
- **WHEN** `sftpClient.connect({ ... authType: 'password' }, 'wrongpass')` is called
- **THEN** the method rejects with an error containing the SSH2 failure reason

#### Scenario: Key auth connect succeeds
- **WHEN** `sftpClient.connect({ ... authType: 'key', keyPath: '/path/to/key' }, passphrase)` is called with a valid private key
- **THEN** the method resolves without error

### Requirement: File upload with progress events
`sftpClient.uploadFile(localPath, remotePath, onProgress)` SHALL upload a single local file to the given remote path. It MUST call `onProgress(transferred, total)` at regular intervals during the transfer. The remote directory MUST be created if it does not exist before uploading.

#### Scenario: Progress callback called during upload
- **WHEN** a 1 MB file is uploaded via `uploadFile`
- **THEN** `onProgress` is called at least once with `transferred > 0` and `total === fileSize`

#### Scenario: Remote directory created if missing
- **WHEN** `uploadFile` is called with a `remotePath` whose parent directory does not exist on the server
- **THEN** the parent directory is created and the file is uploaded successfully

#### Scenario: Upload completes and file exists on remote
- **WHEN** `uploadFile` resolves successfully
- **THEN** the file exists on the SFTP server at `remotePath` with the correct byte size

### Requirement: Upload cancellation
`sftpClient` SHALL honour a cancellation signal. When `cancelUpload()` is called on the client instance, the in-progress upload MUST stop at the next progress tick. The partial remote file MUST be deleted after cancellation.

#### Scenario: Cancel stops upload
- **WHEN** `cancelUpload()` is called while an upload is in progress
- **THEN** `uploadFile` rejects with a cancellation error and no further `onProgress` callbacks are fired

#### Scenario: Partial file removed on cancel
- **WHEN** an upload is cancelled mid-transfer
- **THEN** the remote file at `remotePath` does not exist after the rejection

### Requirement: Clean disconnect
`sftpClient.disconnect()` SHALL close the SFTP session and underlying SSH connection. It MUST be safe to call even if the client is already disconnected (idempotent).

#### Scenario: Disconnect closes connection
- **WHEN** `disconnect()` is called after a successful upload
- **THEN** the SSH connection is closed and the client cannot be used to upload without reconnecting

#### Scenario: Disconnect is idempotent
- **WHEN** `disconnect()` is called twice in succession
- **THEN** no error is thrown on the second call

### Requirement: ZIP bundle creation
`zipBuilder.createZip(anchorPath, filePaths)` SHALL create a ZIP archive containing all files in `filePaths`. The output file SHALL be saved in the same directory as `anchorPath`, with the filename `{anchorStem}_{YYYYMMDDTHHmmss}.zip`. The method SHALL return the absolute path of the created ZIP file.

#### Scenario: ZIP created in correct location
- **WHEN** `createZip('/invoices/INV-001.xml', ['/invoices/INV-001.xml', '/invoices/INV-001.pdf'])` is called
- **THEN** a file named `INV-001_20260410T143022.zip` (or current timestamp) is created in `/invoices/` and its path is returned

#### Scenario: ZIP contains all specified files
- **WHEN** the returned ZIP file is opened
- **THEN** it contains exactly the files listed in `filePaths`, with their basenames as entry names (no directory prefix)

#### Scenario: Timestamp format is ISO 8601 compact
- **WHEN** the ZIP filename is inspected
- **THEN** the timestamp portion matches the pattern `\d{8}T\d{6}` (YYYYMMDDTHHmmss)

### Requirement: Remote directory listing for browser
`sftpClient.listDirectory(remotePath)` SHALL return an array of `RemoteEntry` objects for the given remote path. Each entry MUST include `name`, `type` (`'directory'` or `'file'`), and `path` (full absolute remote path).

#### Scenario: Directory listing returns entries
- **WHEN** `sftpClient.listDirectory('/intake')` is called on a connected client
- **THEN** the method resolves with an array where each item has `name`, `type`, and `path` fields

#### Scenario: Empty directory returns empty array
- **WHEN** `sftpClient.listDirectory('/intake/empty')` is called on an empty directory
- **THEN** the method resolves with `[]`
