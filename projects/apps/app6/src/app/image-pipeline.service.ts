// services/image-pipeline.service.ts
import { computed, Injectable, signal } from '@angular/core';
import { atom, catchError, filter, from, map, mergeMap, pipe, tap } from '@epikodelabs/streamix';
import { zipSync } from 'fflate';
import { actor, ActorBusMessage, main } from '@epikodelabs/streamix/coroutines';
import { compressImage, CompressOutput, DEFAULT_SETTINGS, FileTask, JobProgress, ProcessedResult, ProcessingSettings, ProcessInput, resizeImage, ResizeOutput, } from './image-processing.utils';
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
    private fileStream = atom<FileTask>();
    private progressStream = atom<{
        id: string;
        progress: JobProgress;
    }>();
    readonly settings = signal<ProcessingSettings>({ ...DEFAULT_SETTINGS });
    readonly jobs = signal<ImageJob[]>([]);
    readonly doneCount = computed(() => this.jobs().filter(j => j.state === 'done').length);
    readonly totalSaved = computed(() => this.jobs()
        .filter(j => j.state === 'done')
        .reduce((sum, j) => sum + (j.result?.saved ?? 0), 0));
    readonly isProcessing = computed(() => this.jobs().some(j => j.state === 'processing'));
    private resizeActor = actor<ResizeOutput, any, any, ProcessInput>('image-resize', (msg: ProcessInput, _state: any, utils: any) => resizeImage(msg, utils), null!, resizeImage);
    private compressActor = actor<CompressOutput, any, any, ResizeOutput>('image-compress', (msg: ResizeOutput, _state: any, utils: any) => compressImage(msg, utils), null!, compressImage);
    constructor() {
        main.inbox.subscribe((message: ActorBusMessage<any>) => {
            if (message.topic !== 'progress') {
                return;
            }
            const progress = message.payload as JobProgress;
            this.progressStream.next({ id: progress.taskId!, progress });
        });
        this.progressStream.subscribe(({ id, progress }) => {
            this.jobs.update(list => list.map(j => (j.id === id ? { ...j, progress, state: 'processing' as const } : j)));
        });
        pipe(this.fileStream, filter((task) => task.file.type.startsWith('image/')), mergeMap((task) => pipe(from(this.readFile(task.file)), map(({ arrayBuffer }) => {
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
        }), catchError((err) => {
            console.error('Read file error:', err);
            this.jobs.update(list => list.map(j => j.id === task.id
                ? { ...j, state: 'error' as const, error: String(err?.message ?? err) }
                : j));
        }))), mergeMap((input) => pipe(from(this.runPipeline(input)), map((output) => ({ input, output })), tap(({ input, output }) => {
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
            this.jobs.update(list => list.map(j => j.id === input.taskId
                ? { ...j, state: 'done' as const, resultUrl: url, result, progress: { stage: 'idle' as const, percent: 100 } }
                : j));
        }), catchError((err) => {
            console.error('Pipeline error:', err);
            this.jobs.update(list => list.map(j => j.id === input.taskId
                ? { ...j, state: 'error' as const, error: String(err?.message ?? err) }
                : j));
        })))).subscribe(() => { });
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
            if (job?.resultUrl)
                URL.revokeObjectURL(job.resultUrl);
            if (job?.originalUrl)
                URL.revokeObjectURL(job.originalUrl);
            return list.filter(j => j.id !== id);
        });
    }
    clearAll() {
        const list = this.jobs();
        for (const job of list) {
            if (job.resultUrl)
                URL.revokeObjectURL(job.resultUrl);
            if (job.originalUrl)
                URL.revokeObjectURL(job.originalUrl);
        }
        this.jobs.set([]);
    }
    updateSettings(patch: Partial<ProcessingSettings>) {
        this.settings.update(s => ({ ...s, ...patch }));
    }
    async downloadAll() {
        const doneJobs = this.jobs().filter(j => j.state === 'done' && j.resultUrl);
        if (!doneJobs.length)
            return;
        const files: Record<string, Uint8Array> = {};
        const seen = new Set<string>();
        for (const job of doneJobs) {
            const ext = job.result?.format === 'image/png'
                ? 'png'
                : job.result?.format === 'image/webp'
                    ? 'webp'
                    : 'jpg';
            const base = job.fileName.replace(/\.[^.]+$/, '') || 'image';
            let finalName = `${base}.${ext}`;
            let counter = 1;
            while (seen.has(finalName)) {
                finalName = `${base}-${counter}.${ext}`;
                counter++;
            }
            seen.add(finalName);
            const res = await fetch(job.resultUrl!);
            const buf = await res.arrayBuffer();
            files[finalName] = new Uint8Array(buf);
        }
        const zipped = zipSync(files, { level: 0 });
        const blob = new Blob([zipped], { type: 'application/zip' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `processed-images-${new Date().toISOString().slice(0, 10)}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
    private async readFile(file: File): Promise<{
        arrayBuffer: ArrayBuffer;
        url: string;
    }> {
        const arrayBuffer = await file.arrayBuffer();
        return { arrayBuffer, url: URL.createObjectURL(file) };
    }
    private async runPipeline(input: ProcessInput): Promise<CompressOutput> {
        const resized = await main.outbox.request<ProcessInput, ResizeOutput>(this.resizeActor, 'process', input);
        const compressed = await main.outbox.request<ResizeOutput, CompressOutput>(this.compressActor, 'process', resized);
        return compressed;
    }
    ngOnDestroy() {
        main.outbox.stop(this.resizeActor);
        main.outbox.stop(this.compressActor);
        this.fileStream.dispose();
        this.progressStream.dispose();
        this.clearAll();
    }
}
