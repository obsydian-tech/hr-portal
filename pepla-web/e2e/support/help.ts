import { test as base, expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Help mode for journey tests.
 *
 * Write a journey once, with its help steps in it:
 *
 *   test('HR adds a new employee', async ({ page, help }) => {
 *     await page.goto('/people');
 *     await help.tap('Add employee');                  // caption: "Tap Add employee"
 *     await help.fill('First name', 'Thandi');         // caption: "Enter First name"
 *     await help.shot('onboard/add-employee/01-details');
 *   });
 *
 * Normal run: tap/fill/step just do the action and shot() does nothing.
 * Help mode (HELP_SHOTS=1): each step shows its caption on screen first, then
 * acts; shot() saves a clean picture; the whole journey is saved as a video.
 *
 * Captions use the same name the test uses to find the button or field, so a
 * renamed button fails the test instead of leaving a stale caption.
 */

export const HELP = process.env['HELP_SHOTS'] === '1';
const MEDIA = join(__dirname, '..', '..', 'help', 'media');
const NAME = /^[a-z0-9-]+(\/[a-z0-9-]+)*$/;
/** "Today" in every help picture, so dates never change between retakes. */
export const HELP_TODAY = new Date('2026-03-02T09:00:00+02:00');
const CAPTION_MS = 1200;

export class Help {
  readonly on = HELP;
  private firstStepAt: number | null = null;
  private videoName: string | null = null;

  constructor(
    private readonly page: Page,
    private readonly info: TestInfo,
    readonly startedAt: number,
  ) {}

  private get phone(): boolean {
    return this.info.project.name === 'phone';
  }

  /** Show a caption (help mode only), then run the action. */
  async step(caption: string, action?: () => Promise<unknown>): Promise<void> {
    if (this.on) {
      this.firstStepAt ??= Date.now();
      await this.showCaption(caption);
    }
    if (action) await action();
  }

  /** Press a button by its exact visible name. Caption: "Tap <name>" / "Click <name>". */
  async tap(name: string, within: Page | Locator = this.page): Promise<void> {
    const button = within.getByRole('button', { name, exact: true });
    await expect(button).toBeVisible();
    await this.step(`${this.phone ? 'Tap' : 'Click'} ${name}`, () => button.click());
  }

  /** Type into a field by its exact label. Caption: "Enter <label>". */
  async fill(label: string, value: string, within: Page | Locator = this.page): Promise<void> {
    const field = within.getByLabel(label, { exact: true });
    await expect(field).toBeVisible();
    await this.step(`Enter ${label}`, () => (this.on ? field.pressSequentially(value, { delay: 60 }) : field.fill(value)));
  }

  /** Save a help picture as help/media/<desktop|phone>/<name>.png (help mode only). */
  async shot(name: string): Promise<void> {
    if (!NAME.test(name)) throw new Error(`help.shot: "${name}" must be lower-case words with - and /`);
    if (!this.on) return;
    await this.hideCaption();
    await this.page.waitForLoadState('networkidle');
    const path = join(MEDIA, this.info.project.name, `${name}.png`);
    mkdirSync(dirname(path), { recursive: true });
    await this.page.screenshot({ path, animations: 'disabled', caret: 'hide' });
  }

  /** Name this journey's walkthrough video (defaults to the test title). */
  video(name: string): void {
    if (!NAME.test(name)) throw new Error(`help.video: "${name}" must be lower-case words with - and /`);
    this.videoName = name;
  }

  /** Called after the test: keep the video from the first step onwards. */
  async saveVideo(): Promise<void> {
    const video = this.page.video();
    if (!this.on || !video || this.info.status !== 'passed') return;
    const name = this.videoName ?? slug(this.info.title);
    await this.page.close();
    const raw = await video.path();
    const out = join(MEDIA, this.info.project.name, `${name}.webm`);
    mkdirSync(dirname(out), { recursive: true });
    // Start on the page, not the blank tab or loading screen.
    const skip = Math.max(0, ((this.firstStepAt ?? this.startedAt) - this.startedAt) / 1000 - 0.3);
    if (hasFfmpeg()) {
      rmSync(out, { force: true });
      execFileSync('ffmpeg', ['-loglevel', 'error', '-ss', skip.toFixed(2), '-i', raw, '-c:v', 'libvpx-vp9', '-crf', '40', '-b:v', '0', '-an', out]);
    } else {
      await video.saveAs(out);
      console.warn(`[help] ffmpeg not found: ${name}.webm keeps its first ${skip.toFixed(1)} s of loading`);
    }
  }

  private async showCaption(text: string): Promise<void> {
    await this.page.evaluate((t) => {
      let el = document.getElementById('__help_caption');
      if (!el) {
        el = document.createElement('div');
        el.id = '__help_caption';
        el.setAttribute('aria-hidden', 'true');
        Object.assign(el.style, {
          position: 'fixed', left: '50%', bottom: '24px', transform: 'translateX(-50%)', zIndex: '2147483647',
          maxWidth: 'calc(100vw - 32px)', padding: '10px 16px', borderRadius: '8px', pointerEvents: 'none',
          background: 'rgba(20, 20, 24, 0.88)', color: '#fff', font: '600 16px/1.35 system-ui, sans-serif', textAlign: 'center',
        });
        document.body.appendChild(el);
      }
      el.textContent = t;
      el.style.display = 'block';
    }, text);
    await this.page.waitForTimeout(CAPTION_MS);
  }

  private async hideCaption(): Promise<void> {
    await this.page.evaluate(() => {
      const el = document.getElementById('__help_caption');
      if (el) el.style.display = 'none';
    });
  }
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
let ffmpeg: boolean | undefined;
const hasFfmpeg = () => (ffmpeg ??= (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })());

export const test = base.extend<{ help: Help }>({
  help: async ({ page }, use, testInfo) => {
    if (HELP) await page.clock.setFixedTime(HELP_TODAY);
    const help = new Help(page, testInfo, Date.now());
    await use(help);
    await help.saveVideo();
  },
});

export { expect };
