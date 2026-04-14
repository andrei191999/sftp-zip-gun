import * as vscode from 'vscode';

let _channel: vscode.OutputChannel | undefined;

export function initLogger(context: vscode.ExtensionContext): void {
  _channel = vscode.window.createOutputChannel('SFTP Zip Gun');
  context.subscriptions.push(_channel);
}

export function log(level: 'info' | 'warn' | 'error', message: string): void {
  if (!_channel) { return; }
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 23);
  const prefix = level === 'error' ? '[ERR]' : level === 'warn' ? '[WRN]' : '[INF]';
  _channel.appendLine(`${ts} ${prefix} ${message}`);
}
