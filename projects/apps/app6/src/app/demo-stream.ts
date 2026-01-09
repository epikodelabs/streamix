import {
  concatMap,
  createStream,
  debounce,
  distinctUntilChanged,
  filter,
  map,
  scan,
  throttle
} from '@epikodelabs/streamix';

export const createDemoStream = () =>
  createStream('demo', async function* () {
    for (let i = 1; i <= 6; i += 1) {
      yield i;
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  });

export const runDemoStream = (hooks?: { onOut?: (value: number) => void; onDone?: () => void }) => {
  // const stream = createDemoStream();
  // stream
  //   .pipe(
  //     map((x) => x * 2),
  //     filter((x) => x % 3 !== 0),
  //     mergeMap((x) => [x, x + 10, x + 20]),
  //     bufferCount(5),
  //     map((items) => items.reduce((sum, value) => sum + value, 0))
  //   )
  //   .subscribe({ next: (value) => console.log('demo out', value) });

  // const errorStream = createDemoStream();
  // errorStream
  //   .pipe(
  //     map((x) => x * 3),
  //     map((x) => {
  //       if (x >= 12) {
  //         throw new Error('demo boom');
  //       }
  //       return x;
  //     })
  //   )
  //   .subscribe({
  //     next: (value) => console.log('demo error out', value),
  //     error: (err) => console.warn('demo error', err),
  //   });

  // const variableStream = createDemoStream();
  // const mergeLenCounts = new Map<number, number>();
  // variableStream
  //   .pipe(
  //     mergeMap((x) =>
  //       createStream(`inner-${x}`, async function* () {
  //         const count = (x % 5) + 1;
  //         for (let i = 0; i < count; i += 1) {
  //           yield x * 100 + i;
  //           await new Promise((resolve) => setTimeout(resolve, 20));
  //         }
  //       })
  //     )
  //   )
  //   .subscribe({
  //     next: (value) => {
  //       const parent = Math.floor(value / 100);
  //       mergeLenCounts.set(parent, (mergeLenCounts.get(parent) ?? 0) + 1);
  //       console.log('demo merge len out', value);
  //     },
  //     complete: () => console.log('demo merge len counts', Array.from(mergeLenCounts.entries())),
  //   });

  // const overlapSource = createStream('demo-overlap', async function* () {
  //   for (let i = 1; i <= 8; i += 1) {
  //     yield i;
  //     await new Promise((resolve) => setTimeout(resolve, 25));
  //   }
  // });

  // overlapSource
  //   .pipe(
  //     mergeMap((x) =>
  //       createStream(`inner-overlap-${x}`, async function* () {
  //         const count = (x % 5) + 1;
  //         for (let i = 0; i < count; i += 1) {
  //           await new Promise((resolve) => setTimeout(resolve, 90 - x * 7 + i * 12));
  //           yield x * 100 + i;
  //         }
  //       })
  //     )
  //   )
  //   .subscribe({ next: (value) => console.log('demo merge overlap out', value) });

  const sophisticatedSource = createStream('demo-sophisticated', async function* () {
    for (let i = 1; i <= 30; i += 1) {
      yield i;
    }
  });

  sophisticatedSource
  .pipe(
    map((x) => x * 2),
    filter((x) => x % 4 !== 0),
    concatMap((x, idx) =>
      createStream(`inner-soph-${idx}`, async function* () {
        yield x;
        await new Promise((resolve) => setTimeout(resolve, 8));
        yield x + idx;
        await new Promise((resolve) => setTimeout(resolve, 6));
        yield x * 10;
      })
    ),
    scan((acc, x) => acc + x, 0),
    distinctUntilChanged(),
    map((sum) => sum % 1000),
    throttle(30),
    debounce(15)
  )
  .subscribe({
    next: (value) => {
      console.log('demo sophisticated out', value);
      hooks?.onOut?.(value);
    },
    complete: () => {
      console.log('demo sophisticated done');
      hooks?.onDone?.();
    },
  });
};
