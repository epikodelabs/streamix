import { CommonModule } from '@angular/common';
import { Component, OnDestroy, signal } from '@angular/core';
import {
  catchError,
  concatMap,
  createSubject,
  fromPromise,
  map,
  tap,
} from '@epikodelabs/streamix';
import { compute } from '@epikodelabs/streamix/coroutines';

export interface TextTask {
  id: string;
  fileName: string;
  content: string;
}

export interface TextResult {
  words: number;
  lines: number;
  chars: number;
  topWords: [string, number][];
  readingTimeMinutes: number;
}

export interface Job {
  id: string;
  fileName: string;
  state: 'queued' | 'processing' | 'done' | 'error';
  progress: number;
  originalSize: number;
  result?: TextResult;
  error?: string;
}

function countWords(text: string): number {
  const matches = text.match(/\b[\w']+\b/g);
  return matches ? matches.length : 0;
}

function getTopWords(text: string): [string, number][] {
  const words = text.toLowerCase().match(/\b[\w']{3,}\b/g) || [];
  const stopWords = new Set([
    'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'her', 'was', 'one', 'our', 'out', 'day', 'get', 'has', 'him', 'his', 'how', 'its', 'may', 'new', 'now', 'old', 'see', 'two', 'who', 'boy', 'did', 'she', 'use', 'her', 'way', 'many', 'would', 'there', 'their', 'what', 'said', 'each', 'which', 'she', 'do', 'how', 'their', 'if', 'will', 'up', 'other', 'about', 'out', 'many', 'then', 'them', 'these', 'so', 'some', 'her', 'would', 'make', 'like', 'into', 'him', 'has', 'two', 'more', 'very', 'what', 'know', 'just', 'first', 'also', 'after', 'back', 'other', 'many', 'than', 'only', 'those', 'come', 'day', 'most', 'us', 'over', 'think', 'where', 'being', 'every', 'great', 'might', 'shall', 'still', 'those', 'while', 'this', 'that', 'with', 'from', 'they', 'have', 'been', 'were', 'said', 'time', 'than', 'them', 'into', 'just', 'like', 'over', 'also', 'back', 'only', 'know', 'take', 'year', 'good', 'some', 'come', 'make', 'well', 'work', 'life', 'even', 'more', 'here', 'look', 'down', 'most', 'long', 'last', 'find', 'give', 'does', 'made', 'part', 'such', 'keep', 'call', 'came', 'need', 'feel', 'seem', 'turn', 'hand', 'head', 'help', 'home', 'side', 'both', 'five', 'once', 'same', 'must', 'name', 'left', 'each', 'done', 'open', 'case', 'show', 'live', 'play', 'went', 'told', 'seen', 'hear', 'talk', 'soon', 'read', 'stop', 'face', 'fact', 'land', 'line', 'kind', 'next', 'word', 'came', 'went', 'told', 'knew', 'seen', 'got', 'got', 'get', 'let', 'put', 'say', 'she', 'try', 'way', 'own', 'say', 'too', 'old', 'tell', 'very', 'when', 'much', 'want', 'here', 'look', 'down', 'most', 'long', 'last', 'find', 'give', 'does', 'made', 'part', 'such', 'keep', 'call', 'came', 'need', 'feel', 'seem', 'turn', 'hand', 'head', 'help', 'home', 'side', 'both', 'five', 'once', 'same', 'must', 'name', 'left', 'each', 'done', 'open', 'case', 'show', 'live', 'play', 'went', 'told', 'seen', 'hear', 'talk', 'soon', 'read', 'stop', 'face', 'fact', 'land', 'line', 'kind', 'next', 'word', 'came', 'went', 'told', 'knew', 'seen'
  ]);
  const freq = new Map<string, number>();
  for (const w of words) {
    if (stopWords.has(w)) continue;
    freq.set(w, (freq.get(w) || 0) + 1);
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
}

function analyzeText(data: TextTask): TextResult {
  const text = data.content;
  const lines = text.split(/\r?\n/).length;
  const chars = text.length;
  const words = countWords(text);
  const topWords = getTopWords(text);
  const readingTimeMinutes = Math.ceil(words / 200);
  return { words, lines, chars, topWords, readingTimeMinutes };
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="app">
      <header class="header">
        <h1>📝 Text Analyzer</h1>
        <p class="subtitle">Batch text processing with Web Worker coroutines</p>
      </header>

      <section class="toolbar">
        <div class="stats" *ngIf="jobs().length">
          <span class="pill">{{ jobs().length }} files</span>
          <span class="pill done" *ngIf="doneCount()">{{ doneCount() }} done</span>
          <span class="pill" *ngIf="totalWords() > 0">{{ totalWords() | number }} words</span>
        </div>
        <button class="btn btn-ghost" *ngIf="jobs().length" (click)="clearAll()">Clear all</button>
      </section>

      <section
        class="dropzone"
        [class.dragover]="dragOver()"
        (dragover)="onDragOver($event)"
        (dragleave)="onDragLeave($event)"
        (drop)="onDrop($event)"
        (click)="fileInput.click()"
      >
        <input #fileInput type="file" multiple accept=".txt,.md,.csv,.json" hidden (change)="onFiles($event)" />
        <div class="dropzone-content">
          <div class="icon">📁</div>
          <p><strong>Drop text files here</strong> or click to browse</p>
          <p class="hint">TXT, MD, CSV, JSON · Processed in parallel via workers</p>
        </div>
      </section>

      <section class="results" *ngIf="jobs().length">
        <div class="result-card" *ngFor="let job of jobs()" [class.done]="job.state === 'done'" [class.error]="job.state === 'error'">
          <div class="result-header">
            <span class="filename" [title]="job.fileName">{{ job.fileName }}</span>
            <span class="status">{{ job.state }}</span>
          </div>

          <div class="progress" *ngIf="job.state === 'processing'">
            <div class="progress-bar" [style.width.%]="job.progress"></div>
          </div>

          <div class="result-body" *ngIf="job.state === 'done' && job.result">
            <div class="metrics">
              <div class="metric">
                <span class="metric-value">{{ job.result.words | number }}</span>
                <span class="metric-label">Words</span>
              </div>
              <div class="metric">
                <span class="metric-value">{{ job.result.lines | number }}</span>
                <span class="metric-label">Lines</span>
              </div>
              <div class="metric">
                <span class="metric-value">{{ job.result.chars | number }}</span>
                <span class="metric-label">Chars</span>
              </div>
              <div class="metric">
                <span class="metric-value">{{ job.result.readingTimeMinutes }} min</span>
                <span class="metric-label">Read time</span>
              </div>
            </div>

            <div class="top-words" *ngIf="job.result.topWords.length">
              <span class="top-label">Top words</span>
              <div class="top-list">
                <span class="top-item" *ngFor="let tw of job.result.topWords">
                  {{ tw[0] }} <strong>{{ tw[1] }}</strong>
                </span>
              </div>
            </div>
          </div>

          <div class="error-body" *ngIf="job.state === 'error'">
            <span>⚠️ {{ job.error }}</span>
          </div>
        </div>
      </section>

      <footer class="footer" *ngIf="jobs().length">
        <p>Powered by <strong>Streamix Coroutines</strong> · Worker-parallel text analysis</p>
      </footer>
    </div>
  `,
  styles: [`
    :host {
      --bg: #0f1117;
      --surface: #181b24;
      --surface-hover: #1e2230;
      --border: #2a2f3f;
      --text: #e2e5ec;
      --text-muted: #8b92a8;
      --accent: #5b8cff;
      --accent-hover: #4a7aee;
      --success: #3ddc84;
      --error: #ff5f5f;
      --radius: 12px;
      display: block;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }

    .app { max-width: 1200px; margin: 0 auto; padding: 32px 24px; }

    .header { text-align: center; margin-bottom: 28px; }
    .header h1 { font-size: 2rem; font-weight: 700; margin: 0 0 6px; letter-spacing: -0.5px; }
    .subtitle { color: var(--text-muted); font-size: 0.95rem; margin: 0; }

    .toolbar {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 16px; gap: 12px; flex-wrap: wrap;
    }
    .stats { display: flex; gap: 8px; flex-wrap: wrap; }
    .pill {
      background: var(--surface); border: 1px solid var(--border);
      padding: 4px 12px; border-radius: 999px; font-size: 0.8rem; color: var(--text-muted);
    }
    .pill.done { color: var(--success); border-color: rgba(61,220,132,0.3); }

    .btn {
      cursor: pointer; border: none; border-radius: 8px; padding: 8px 16px;
      font-size: 0.85rem; font-weight: 500; transition: background 0.15s, transform 0.05s;
    }
    .btn:active { transform: scale(0.97); }
    .btn-ghost { background: transparent; color: var(--text-muted); border: 1px solid var(--border); }
    .btn-ghost:hover { background: var(--surface-hover); color: var(--text); }

    .dropzone {
      border: 2px dashed var(--border); border-radius: var(--radius);
      background: var(--surface); padding: 48px 24px; text-align: center;
      cursor: pointer; transition: border-color 0.2s, background 0.2s;
    }
    .dropzone:hover, .dropzone.dragover {
      border-color: var(--accent); background: rgba(91,140,255,0.05);
    }
    .dropzone-content .icon { font-size: 2.5rem; margin-bottom: 12px; }
    .dropzone-content p { margin: 4px 0; color: var(--text); }
    .dropzone-content .hint { font-size: 0.8rem; color: var(--text-muted); }

    .results {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 20px; margin-top: 28px;
    }
    .result-card {
      background: var(--surface); border: 1px solid var(--border);
      border-radius: var(--radius); overflow: hidden;
      transition: transform 0.15s, box-shadow 0.15s;
    }
    .result-card:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.3); }

    .result-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 14px 16px; background: var(--bg); border-bottom: 1px solid var(--border);
    }
    .filename { font-weight: 500; font-size: 0.9rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 70%; }
    .status { font-size: 0.75rem; text-transform: capitalize; color: var(--accent); }
    .result-card.done .status { color: var(--success); }
    .result-card.error .status { color: var(--error); }

    .progress {
      height: 4px; background: var(--bg); margin: 0 16px;
    }
    .progress-bar {
      height: 100%; background: var(--accent); border-radius: 2px;
      transition: width 0.3s ease;
    }

    .result-body { padding: 16px; display: flex; flex-direction: column; gap: 14px; }
    .metrics { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
    .metric {
      background: var(--bg); border: 1px solid var(--border);
      border-radius: 8px; padding: 10px; text-align: center;
    }
    .metric-value { display: block; font-size: 1.1rem; font-weight: 700; color: var(--accent); }
    .metric-label { font-size: 0.72rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }

    .top-words { display: flex; flex-direction: column; gap: 6px; }
    .top-label { font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
    .top-list { display: flex; flex-wrap: wrap; gap: 6px; }
    .top-item {
      background: rgba(91,140,255,0.12); color: var(--accent);
      padding: 3px 10px; border-radius: 4px; font-size: 0.8rem;
    }
    .top-item strong { margin-left: 4px; color: var(--text); }

    .error-body {
      padding: 16px; color: var(--error); font-size: 0.85rem;
    }

    .footer { text-align: center; margin-top: 32px; padding-top: 20px; border-top: 1px solid var(--border); }
    .footer p { color: var(--text-muted); font-size: 0.8rem; margin: 0; }
    .footer strong { color: var(--accent); }
  `],
})
export class AppComponent implements OnDestroy {
  jobs = signal<Job[]>([]);
  dragOver = signal(false);
  doneCount = signal(0);
  totalWords = signal(0);

  private taskSubject = createSubject<TextTask>();
  private runner = compute(analyzeText, countWords, getTopWords);

  constructor() {
    this.taskSubject.pipe(
      tap((task) => {
        this.jobs.update(list =>
          list.map(j => (j.id === task.id ? { ...j, state: 'processing' as const, progress: 10 } : j))
        );
      }),
      concatMap((task) =>
        fromPromise(this.runner(task)).pipe(
          map((result) => ({ task, result })),
          tap(({ task: t, result }) => {
            this.jobs.update(list =>
              list.map(j =>
                j.id === t.id
                  ? { ...j, state: 'done' as const, progress: 100, result }
                  : j
              )
            );
            this.doneCount.update(c => c + 1);
            this.totalWords.update(w => w + result.words);
          }),
          catchError((err) => {
            this.jobs.update(list =>
              list.map(j =>
                j.id === task.id
                  ? { ...j, state: 'error' as const, error: String(err?.message ?? err) }
                  : j
              )
            );
          })
        )
      )
    ).subscribe();
  }

  onFiles(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files) {
      Array.from(input.files).forEach(f => this.uploadFile(f));
      input.value = '';
    }
  }

  onDragOver(e: DragEvent): void {
    e.preventDefault();
    e.stopPropagation();
    this.dragOver.set(true);
  }

  onDragLeave(e: DragEvent): void {
    e.preventDefault();
    e.stopPropagation();
    this.dragOver.set(false);
  }

  onDrop(e: DragEvent): void {
    e.preventDefault();
    e.stopPropagation();
    this.dragOver.set(false);
    if (e.dataTransfer?.files) {
      Array.from(e.dataTransfer.files).forEach(f => this.uploadFile(f));
    }
  }

  clearAll(): void {
    this.jobs.set([]);
    this.doneCount.set(0);
    this.totalWords.set(0);
  }

  ngOnDestroy(): void {
    this.runner.finalize();
  }

  private async uploadFile(file: File): Promise<void> {
    const id = crypto.randomUUID();
    const text = await file.text();

    this.jobs.update(list => [
      ...list,
      {
        id,
        fileName: file.name,
        state: 'queued',
        progress: 0,
        originalSize: file.size,
      },
    ]);

    this.taskSubject.next({ id, fileName: file.name, content: text });
  }
}
