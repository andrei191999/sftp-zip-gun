/**
 * Live visibility helpers for headed Playwright runs.
 *
 * Two opt-in features wired from launch-vscode.ts:
 *
 *   HIGHLIGHT=1 — installs a document-level listener on the workbench page and
 *     the upload-panel frame that flashes a red outline on any element being
 *     clicked, focused, typed into, or changed. Also patches Locator.prototype
 *     methods so the *exact* targeted element flashes even when the underlying
 *     DOM event would fire on a child node (e.g. an SVG inside a button).
 *
 *   SLOW_MO=N  — patches Locator.prototype methods (click/fill/...) to wait N ms
 *     before delegating. _electron.launch() does not honour the launchOptions
 *     slowMo, so we do it ourselves at the action level.
 *
 * Both effects are idempotent: prototype patching runs once per worker process
 * (the prototype is shared across every Locator), HIGHLIGHT bootstraps once
 * per page/frame via a window flag.
 */

import type { Frame, Locator, Page } from '@playwright/test';

type EvaluatableTarget = Pick<Page, 'evaluate' | 'locator'> | Pick<Frame, 'evaluate' | 'locator'>;

const HIGHLIGHT_BOOTSTRAP = `(() => {
  const w = window;
  if (w.__pw_highlight_installed) return;
  w.__pw_highlight_installed = true;

  const css = [
    '@keyframes pw-highlight-fade {',
    '  0%   { outline-color: rgba(255, 50, 50, 1);   box-shadow: 0 0 0 12px rgba(255, 50, 50, 0.65); transform: scale(1.04); }',
    '  20%  { outline-color: rgba(255, 50, 50, 1);   box-shadow: 0 0 0 12px rgba(255, 50, 50, 0.55); transform: scale(1.0); }',
    '  70%  { outline-color: rgba(255, 50, 50, 0.85); box-shadow: 0 0 0 10px rgba(255, 50, 50, 0.30); }',
    '  100% { outline-color: rgba(255, 50, 50, 0);   box-shadow: 0 0 0 10px rgba(255, 50, 50, 0); }',
    '}',
    '.pw-highlight-active {',
    '  outline: 5px solid rgba(255, 50, 50, 1) !important;',
    '  outline-offset: 3px !important;',
    '  animation: pw-highlight-fade 850ms ease-out forwards !important;',
    '  transform-origin: center !important;',
    '}',
  ].join('\\n');

  const style = document.createElement('style');
  style.textContent = css;
  (document.head || document.documentElement).appendChild(style);

  function flash(el) {
    if (!el || !(el instanceof Element)) return;
    el.classList.remove('pw-highlight-active');
    void el.offsetWidth;
    el.classList.add('pw-highlight-active');
    setTimeout(() => { el.classList.remove('pw-highlight-active'); }, 900);
  }

  document.addEventListener('mousedown', (e) => flash(e.target), true);
  document.addEventListener('click',     (e) => flash(e.target), true);
  document.addEventListener('focusin',   (e) => flash(e.target), true);
  document.addEventListener('input',     (e) => flash(e.target), true);
  document.addEventListener('change',    (e) => flash(e.target), true);
  document.addEventListener('keydown',   () => flash(document.activeElement), true);
})();`;

const SLOWMO_PATCHED = Symbol.for('pw-slowmo-patched');
type LocatorProtoLike = Record<string, unknown> & { [SLOWMO_PATCHED]?: boolean };

const FLASH_SCRIPT = `el => {
  if (!el) return;
  el.classList.remove('pw-highlight-active');
  void el.offsetWidth;
  el.classList.add('pw-highlight-active');
  setTimeout(() => { el.classList.remove('pw-highlight-active'); }, 900);
}`;

function patchLocatorPrototype(locatorInstance: Locator, slowMoMs: number, highlight: boolean): void {
  const proto = Object.getPrototypeOf(locatorInstance) as LocatorProtoLike;
  if (proto[SLOWMO_PATCHED]) return;
  proto[SLOWMO_PATCHED] = true;

  const methods = ['click', 'dblclick', 'fill', 'selectOption', 'check', 'uncheck', 'hover', 'press', 'type'];
  for (const name of methods) {
    const original = proto[name] as ((...args: unknown[]) => Promise<unknown>) | undefined;
    if (typeof original !== 'function') continue;
    proto[name] = async function (this: Locator, ...args: unknown[]) {
      if (highlight) {
        try {
          await this.first().evaluate(FLASH_SCRIPT);
        } catch {
          // locator may not resolve synchronously (e.g. waiting for visibility);
          // DOM listener will still flash on the underlying event
        }
      }
      if (slowMoMs > 0) {
        await new Promise(r => setTimeout(r, slowMoMs));
      }
      return original.apply(this, args);
    };
  }
}

/**
 * Installs HIGHLIGHT (DOM listener + Locator-level guaranteed flash) and
 * SLOW_MO (per-action delay) on the given Page or Frame, based on env vars.
 * Idempotent and safe to call multiple times.
 */
export async function installHighlight(target: EvaluatableTarget): Promise<void> {
  const slowMoMs = Number(process.env.SLOW_MO) || 0;
  const highlight = process.env.HIGHLIGHT === '1';

  if (slowMoMs > 0 || highlight) {
    try {
      patchLocatorPrototype(target.locator('body'), slowMoMs, highlight);
    } catch {
      // worker-private prototype patching may fail on unusual targets; non-fatal
    }
  }

  if (highlight) {
    try {
      await target.evaluate(HIGHLIGHT_BOOTSTRAP);
    } catch {
      // page/frame may not be ready or may have navigated; non-fatal
    }
  }
}
