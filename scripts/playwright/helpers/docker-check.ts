import { execFileSync } from 'child_process';

export function assertDockerRunning(): void {
  let state: string;
  try {
    state = execFileSync(
      'docker',
      ['inspect', '--format', '{{.State.Status}}', 'sftp-zip-gun-qa'],
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim().replace(/^"(.*)"$/, '$1');
  } catch {
    throw new Error(
      'Docker QA container not found. Run: npm run qa:docker:start'
    );
  }
  if (state !== 'running') {
    throw new Error(
      `Docker QA container state is "${state}". Run: npm run qa:docker:start`
    );
  }
}
