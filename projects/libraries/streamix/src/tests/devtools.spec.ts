import {
  recordStreamixDevtoolsEvent,
  streamixDevtoolsEnabled,
  streamixDevtoolsSnapshot,
  subscribeStreamixDevtools,
} from '../lib/runtime/devtools';

describe('Streamix devtools store', () => {
  it('records a bounded, timestamped trace in development builds', () => {
    expect(streamixDevtoolsEnabled).toBeTrue();

    for (let index = 0; index < 260; index += 1) {
      recordStreamixDevtoolsEvent({ type: 'write', source: `s${index}` });
    }

    const snapshot = streamixDevtoolsSnapshot();
    expect(snapshot.length).toBe(250);
    expect(snapshot[249].source).toBe('s259');
    expect(snapshot[249].time).toBeGreaterThan(0);
  });

  it('notifies subscribers asynchronously and stops after unsubscribe', async () => {
    let notifications = 0;
    const unsubscribe = subscribeStreamixDevtools(() => {
      notifications += 1;
    });

    recordStreamixDevtoolsEvent({ type: 'write', source: 'spec' });
    await Promise.resolve();
    expect(notifications).toBe(1);

    unsubscribe();
    recordStreamixDevtoolsEvent({ type: 'write', source: 'spec-2' });
    await Promise.resolve();
    expect(notifications).toBe(1);
  });
});
