import * as crypto from 'crypto';
import * as fs from 'fs';
import * as vscode from 'vscode';

export function getPanelHtml(extensionUri: vscode.Uri, webview: vscode.Webview): string {
  const nonce = crypto.randomBytes(16).toString('hex');
  const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'panel.css'));
  const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'panel.js'));
  const htmlPath = vscode.Uri.joinPath(extensionUri, 'media', 'panel.html');

  return fs
    .readFileSync(htmlPath.fsPath, 'utf8')
    .replace(/\{\{nonce\}\}/g, nonce)
    .replace(/\{\{cspSource\}\}/g, webview.cspSource)
    .replace(/\{\{cssUri\}\}/g, cssUri.toString())
    .replace(/\{\{scriptUri\}\}/g, jsUri.toString());
}
