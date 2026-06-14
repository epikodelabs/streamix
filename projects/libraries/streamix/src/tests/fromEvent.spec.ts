import { fromEvent } from '@epikodelabs/streamix';
import { idescribe } from './env.spec';

const flushMicrotasks = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const delay = (ms = 10) => new Promise<void>(r => setTimeout(r, ms));

idescribe('fromEvent', () => {

  it('should call the overridden subscribe method', async () => {
    const element = document.createElement('button');
    const atom = fromEvent(element, 'click');

    let received: Event | undefined;
    const subscription = atom.subscribe(ev => { received = ev; });

    element.click();
    await flushMicrotasks();

    expect(received).toBeInstanceOf(Event);
    subscription.unsubscribe();
  });

  it('should emit multiple events correctly', async () => {
    const element = document.createElement('button');
    const atom = fromEvent(element, 'click');

    const emitted: Event[] = [];
    const subscription = atom.subscribe(ev => { if (ev !== undefined) emitted.push(ev); });

    element.click();
    element.click();
    await flushMicrotasks();

    expect(emitted.length).toBe(2);
    subscription.unsubscribe();
  });

  it('should remove event listener and unsubscribe on unsubscribe', async () => {
    const element = document.createElement('button');
    const atom = fromEvent(element, 'click');

    let listenerRemoved = false;

    const originalRemove = element.removeEventListener;
    element.removeEventListener = function (...args: any[]) {
      listenerRemoved = true;
      return originalRemove.apply(this, args as any);
    };

    const subscription = atom.subscribe(() => {});

    subscription.unsubscribe();

    await delay(10);
    expect(listenerRemoved).toBe(true);
  });

  it('should not emit events after unsubscribe', async () => {
    const element = document.createElement('button');
    const atom = fromEvent(element, 'click');

    let count = 0;
    const subscription = atom.subscribe(() => count++);

    element.click();
    subscription.unsubscribe();
    element.click();

    await delay(10);
    expect(count).toBe(1);
  });

  it('supports promise-based targets and event names', async () => {
    const element = document.createElement('button');
    const targetPromise = Promise.resolve(element);
    const eventPromise = new Promise<string>((resolve) => setTimeout(() => resolve('click'), 0));

    const atom = fromEvent(targetPromise, eventPromise);
    let received: Event | undefined;
    const subscription = atom.subscribe(ev => { received = ev; });

    await delay(20);
    element.click();
    await flushMicrotasks();

    expect(received).toBeInstanceOf(Event);
    subscription.unsubscribe();
  });

  it('does not attach listener when unsubscribed before pending target resolves', async () => {
    const element = document.createElement('button');

    let listenerAdded = false;
    const originalAdd = element.addEventListener;
    element.addEventListener = function (...args: any[]) {
      listenerAdded = true;
      return originalAdd.apply(this, args as any);
    };

    const targetPromise = new Promise<EventTarget>((resolve) => {
      setTimeout(() => resolve(element), 20);
    });

    const atom = fromEvent(targetPromise, Promise.resolve('click'));
    const subscription = atom.subscribe(() => listenerAdded = true);

    subscription.unsubscribe();

    await delay(40);
    expect(listenerAdded).toBe(false);
    element.addEventListener = originalAdd;
  });
});
