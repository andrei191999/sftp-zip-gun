const NODE_FS_ERROR_CODES = ['ENOENT', 'EACCES', 'EPERM', 'ENOTDIR', 'EISDIR'];

function looksLikeNodeFsError(message: string): boolean {
  const lower = message.toLowerCase();
  const hasCode = NODE_FS_ERROR_CODES.some((code) => message.includes(code));
  const hasPhrase =
    lower.includes('no such file or directory') ||
    lower.includes('permission denied') ||
    lower.includes('operation not permitted');
  const hasFilesystemVerb = /\b(open|scandir|stat|lstat|readfile|unlink|mkdir)\b/i.test(message);
  const hasLikelyLocalPath =
    /[A-Za-z]:\\/.test(message) ||
    /\/(?:Users|home|tmp|var|private)\//.test(message);

  return (hasCode || hasPhrase) && (hasFilesystemVerb || hasLikelyLocalPath);
}

export function sanitizeKeyFileReadError(): string {
  return 'Cannot read the SSH key file. Check that the configured key path exists and is readable.';
}

export function sanitizeUserFacingError(message: string): string {
  const trimmed = message.trim();
  const lower = trimmed.toLowerCase();

  if (lower.includes('cannot read key file')) {
    return sanitizeKeyFileReadError();
  }

  if (looksLikeNodeFsError(trimmed)) {
    return 'A required local file could not be read. Check the selected files, folders, or SSH key path and try again.';
  }

  return trimmed;
}
