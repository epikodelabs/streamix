// services/image-pipeline.service.ts
import { Injectable, NgZone, signal, computed } from '@angular/core';
import {
  createSubject,
  filter,
  fromPromise,
  map,
  switchMap,
  tap,
} from '@epikodelabs/streamix';

import { actor, type CoroutineMessage, type PendingTaskMap } from '@epikodelabs/streamix/coroutines';
import {
  compressImage,
  DEFAULT_SETTINGS,
  FileTask,
  JobProgress,
  ProcessInput,
  ProcessedResult,
  ProcessingSettings,
  resizeImage,
} from './image-processing.utils';

export interface ImageJob {
  id: string;
  fileName: string;
  state: 'queued' | 'processing' | 'done' | 'error';
  progress: JobProgress;
  originalSize: number;
  originalUrl: string;
  resultUrl?: string;
  result?: ProcessedResult;
  error?: string;
  settings: ProcessingSettings;
}

@Injectable({ providedIn: 'root' })
export class ImagePipelineService {
  private fileStream = createSubject<FileTask>();
  private progressStream = createSubject<{ id: string; progress: JobProgress }>();

  readonly settings = signal<ProcessingSettings>({ ...DEFAULT_SETTINGS });

  readonly jobs = signal<ImageJob[]>([]);
  readonly doneCount = computed(() => this.jobs().filter(j => j.state === 'done').length);
  readonly totalSaved = computed(() =>
    this.jobs()
      .filter(j => j.state === 'done')
      .reduce((sum, j) => sum + (j.result?.saved ?? 0), 0)
  );
  readonly isProcessing = computed(() => this.jobs().some(j => j.state === 'processing'));

  private resizeActor = actor({ customMessageHandler: this.makeHandler() })(resizeImage);
  private compressActor = actor({ customMessageHandler: this.makeHandler() })(compressImage);

  constructor(private ngZone: NgZone) {
    this.progressStream.subscribe(({ id, progress }) => {
      this.ngZone.run(() => {
        this.jobs.update(list =>
          list.map(j => (j.id === id ? { ...j, progress, state: 'processing' as const } : j))
        );
      });
    });

    this.fileStream.pipe(
      filter((task) => task.file.type.startsWith('image/')),
      switchMap((task) =>
        fromPromise(this.readFile(task.file)).pipe(
          map(({ arrayBuffer }) => {
            const s = this.settings();
            const input: ProcessInput = {
              blob: arrayBuffer,
              width: s.maxWidth,
              height: s.maxHeight,
              quality: s.quality,
              format: s.format,
              grayscale: s.grayscale,
              taskId: task.id,
              originalSize: task.file.size,
              fileName: task.file.name,
            };
            return input;
          })
        )
      ),
      switchMap((input) =>
        fromPromise(this.runPipeline(input)).pipe(
          map((output) => ({ input, output })),
          tap(({ input, output }) => {
            const finalBlob = new Blob([output.finalBlob], { type: input.format });
            const url = URL.createObjectURL(finalBlob);

            const result: ProcessedResult = {
              id: input.taskId,
              fileName: input.fileName,
              url,
              originalSize: input.originalSize,
              resizedSize: output.resizedSize,
              finalSize: output.compressedSize,
              saved: input.originalSize - output.compressedSize,
              width: output.width,
              height: output.height,
              format: input.format,
            };

            this.ngZone.run(() => {
              this.jobs.update(list =>
                list.map(j =>
                  j.id === input.taskId
                    ? { ...j, state: 'done' as const, resultUrl: url, result, progress: { stage: 'idle' as const, percent: 100 } }
                    : j
                )
              );
            });
          })
        )
      )
    ).subscribe({
      error: (err: any) => {
        console.error('Pipeline error:', err);
        this.ngZone.run(() => {
          this.jobs.update(list =>
            list.map(j =>
              j.state === 'processing' ? { ...j, state: 'error' as const, error: String(err?.message ?? err) } : j
            )
          );
        });
      },
    });
  }

  private makeHandler() {
    return (event: MessageEvent<CoroutineMessage>, _worker: Worker, pendingTasks: PendingTaskMap) => {
      const msg = event.data;
      const { taskId, payload, type, error } = msg as any;

      if (type === 'worker-message') {
        this.ngZone.run(() => {
          this.progressStream.next({ id: taskId, progress: payload as JobProgress });
        });
        return;
      }

      const pending = pendingTasks.get(taskId);
      if (!pending) return;

      if (type === 'response') {
        pendingTasks.delete(taskId);
        pending.resolve(payload);
      } else if (type === 'error') {
        pendingTasks.delete(taskId);
        pending.reject(new Error(error ?? 'Unknown worker error'));
      }
    };
  }

  uploadFile(file: File) {
    const id = crypto.randomUUID();
    const url = URL.createObjectURL(file);

    this.jobs.update(list => [
      ...list,
      {
        id,
        fileName: file.name,
        state: 'queued',
        progress: { stage: 'idle', percent: 0 },
        originalSize: file.size,
        originalUrl: url,
        settings: { ...this.settings() },
      },
    ]);

    this.fileStream.next({ file, id });
  }

  removeJob(id: string) {
    this.jobs.update(list => {
      const job = list.find(j => j.id === id);
      if (job?.resultUrl) URL.revokeObjectURL(job.resultUrl);
      if (job?.originalUrl) URL.revokeObjectURL(job.originalUrl);
      return list.filter(j => j.id !== id);
    });
  }

  clearAll() {
    const list = this.jobs();
    for (const job of list) {
      if (job.resultUrl) URL.revokeObjectURL(job.resultUrl);
      if (job.originalUrl) URL.revokeObjectURL(job.originalUrl);
    }
    this.jobs.set([]);
  }

  updateSettings(patch: Partial<ProcessingSettings>) {
    this.settings.update(s => ({ ...s, ...patch }));
  }

  private async readFile(file: File): Promise<{ arrayBuffer: ArrayBuffer; url: string }> {
    const arrayBuffer = await file.arrayBuffer();
    return { arrayBuffer, url: URL.createObjectURL(file) };
  }

  private async runPipeline(input: ProcessInput) {
    const resized = await this.resizeActor.processTask(input);
    const compressed = await this.compressActor.processTask(resized);
    return compressed;
  }

  ngOnDestroy() {
    this.resizeActor.finalize();
    this.compressActor.finalize();
    this.fileStream.complete();
    this.progressStream.complete();
    this.clearAll();
  }
}
