import * as vscode from 'vscode';
import { StateManager } from '../config/stateManager';

export class StatusBarController implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private spinnerTimer: ReturnType<typeof setInterval> | undefined;
  private readonly spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  private spinnerIdx = 0;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = 'sftpZipGun.openPanel';
    this.item.tooltip = 'SFTP Zip Gun — click to open panel';
  }

  initialize(context: vscode.ExtensionContext, stateManager: StateManager): void {
    this.setIdle(stateManager.getState().lastPresetName);
    context.subscriptions.push(this.item);
  }

  setIdle(presetName?: string): void {
    this.clearSpinner();
    this.item.text = presetName ? `$(cloud-upload) ${presetName}` : '$(cloud-upload) SFTP Zip Gun';
    this.item.show();
  }

  setUploading(): void {
    this.clearSpinner();
    this.spinnerTimer = setInterval(() => {
      this.item.text = `${this.spinnerFrames[this.spinnerIdx++ % this.spinnerFrames.length]} Uploading…`;
    }, 100);
    this.item.show();
  }

  setSuccess(presetName: string): void {
    this.clearSpinner();
    this.item.text = `$(check) ${presetName}`;
    this.item.show();
    setTimeout(() => this.setIdle(presetName), 3000);
  }

  setError(): void {
    this.clearSpinner();
    this.item.text = '$(issue-opened) Upload failed';
    this.item.show();
  }

  private clearSpinner(): void {
    if (this.spinnerTimer !== undefined) {
      clearInterval(this.spinnerTimer);
      this.spinnerTimer = undefined;
    }
  }

  dispose(): void {
    this.clearSpinner();
    this.item.dispose();
  }
}
