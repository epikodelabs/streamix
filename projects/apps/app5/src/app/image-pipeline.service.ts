// services/image-pipeline.service.ts
import { computed, Injectable, signal } from '@angular/core';
import {
    catchError,
    createSubject,
    filter,
    fromPromise,
    map,
    switchMap,
    tap,
} from '@epikodelabs/streamix';

import { actor, main } from '@epikodelabs/streamix/coroutines';
import {
    compressImage,
    CompressOutput,
    DEFAULT_SETTINGS,
    FileTask,
    JobProgress,
    ProcessedResult,
    ProcessingSettings,
    ProcessInput,
    resizeImage,
    ResizeOutput,
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

  private resizeActor = actor<ResizeOutput, any, any, JobProgress, ProcessInput>(
    (msg: ProcessInput, _state: any, utils: any) => resizeImage(msg, utils),
    resizeImage
  )('image-resize', null!);
  private compressActor = actor<CompressOutput, any, any, JobProgress, ResizeOutput>(
    (msg: ResizeOutput, _state: any, utils: any) => compressImage(msg, utils),
    compressImage
  )('image-compress', null!);

  constructor() {
    main.bus.listen('main', (message) => {
      if (message.topic !== 'progress') {
        return;
      }

      const progress = message.payload as JobProgress;
      this.progressStream.next({ id: progress.taskId!, progress });
    });

    this.progressStream.subscribe(({ id, progress }) => {
      this.jobs.update(list =>
        list.map(j => (j.id === id ? { ...j, progress, state: 'processing' as const } : j))
      );
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
          }),
          catchError((err) => {
            console.error('Read file error:', err);
            this.jobs.update(list =>
              list.map(j =>
                j.id === task.id
                  ? { ...j, state: 'error' as const, error: String(err?.message ?? err) }
                  : j
              )
            );
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

            this.jobs.update(list =>
              list.map(j =>
                j.id === input.taskId
                  ? { ...j, state: 'done' as const, resultUrl: url, result, progress: { stage: 'idle' as const, percent: 100 } }
                  : j
              )
            );
          }),
          catchError((err) => {
            console.error('Pipeline error:', err);
            this.jobs.update(list =>
              list.map(j =>
                j.id === input.taskId
                  ? { ...j, state: 'error' as const, error: String(err?.message ?? err) }
                  : j
              )
            );
          })
        )
      )
    ).subscribe();
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

  private async runPipeline(input: ProcessInput): Promise<CompressOutput> {
    const resized = await main.outbox.request<ProcessInput, ResizeOutput>(this.resizeActor, input);
    const compressed = await main.outbox.request<ResizeOutput, CompressOutput>(this.compressActor, resized);
    return compressed;
  }

  ngOnDestroy() {
    main.outbox.stop(this.resizeActor);
    main.outbox.stop(this.compressActor);
    this.fileStream.complete();
    this.progressStream.complete();
    this.clearAll();
  }
}
