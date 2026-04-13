import { Pipe, PipeTransform } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

/**
 * Lightweight markdown-to-HTML pipe for chat messages.
 * Supports: **bold**, *italic*, `code`, \n → <br>, and bullet lists (• / - prefix).
 */
@Pipe({
  name: 'chatMarkdown',
  standalone: true,
})
export class ChatMarkdownPipe implements PipeTransform {
  constructor(private sanitizer: DomSanitizer) {}

  transform(value: string): SafeHtml {
    if (!value) return '';

    let html = this.escapeHtml(value);

    // Bold: **text**
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    // Italic: *text*
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

    // Inline code: `text`
    html = html.replace(/`(.+?)`/g, '<code>$1</code>');

    // Bullet/numbered lists: lines starting with • or - or digit.
    html = html
      .split('\n')
      .map((line) => {
        const trimmed = line.trim();
        if (/^[•\-]\s/.test(trimmed)) {
          return `<span class="chat-list-item">${trimmed}</span>`;
        }
        if (/^\d+\.\s/.test(trimmed)) {
          return `<span class="chat-list-item chat-list-item--numbered">${trimmed}</span>`;
        }
        return line;
      })
      .join('\n');

    // Newlines → <br>
    html = html.replace(/\n/g, '<br>');

    return this.sanitizer.bypassSecurityTrustHtml(html);
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    let escaped = div.innerHTML;
    // Restore markdown characters that we need to process
    escaped = escaped.replace(/&amp;/g, '&');
    return escaped;
  }
}
