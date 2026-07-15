import { addListener } from '@epikodelabs/streamix';
import { idescribe } from './env.spec';

const flushMicrotasks = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const delay = (ms = 10) => new Promise<void>(r => setTimeout(r, ms));

idescribe('fromEvent', () => {

  it('should call the overridden subscribe method', async () => {
    const element = document.createElement('button');
    const atom = addListener(element, 'click');

    let received: Event | undefined;
    const unsubscribe = atom.subscribe(ev => { received = ev; });

    element.click();
    await flushMicrotasks();

    expect(received).toBeInstanceOf(Event);
    unsubscribe();
  });

  it('should emit multiple events correctly', async () => {
    const element = document.createElement('button');
    const atom = addListener(element, 'click');

    const emitted: Event[] = [];
    const unsubscribe = atom.subscribe(ev => { if (ev !== undefined) emitted.push(ev); });

    element.click();
    element.click();
    await flushMicrotasks();

    expect(emitted.length).toBe(2);
    unsubscribe();
  });

  it('should remove event listener and unsubscribe on unsubscribe', async () => {
    const element = document.createElement('button');
    const atom = addListener(element, 'click');

    let listenerRemoved = false;

    const originalRemove = element.removeEventListener;
    element.removeEventListener = function (...args: any[]) {
      listenerRemoved = true;
      return originalRemove.apply(this, args as any);
    };

    const unsubscribe = atom.subscribe(() => {});

    unsubscribe();

    await delay(10);
    expect(listenerRemoved).toBe(true);
  });

  it('should not emit events after unsubscribe', async () => {
    const element = document.createElement('button');
    const atom = addListener(element, 'click');

    let count = 0;
    const unsubscribe = atom.subscribe(() => count++);

    element.click();
    await flushMicrotasks();
    unsubscribe();
    element.click();

    await delay(10);
    expect(count).toBe(1);
  });

  it('supports promise-based targets and event names', async () => {
    const element = document.createElement('button');
    const target$ = Promise.resolve(element);
    const event$ = new Promise<string>((resolve) => setTimeout(() => resolve('click'), 0));

    const atom = addListener(target$, event$);
    let received: Event | undefined;
    const unsubscribe = atom.subscribe(ev => { received = ev; });

    await delay(20);
    element.click();
    await flushMicrotasks();

    expect(received).toBeInstanceOf(Event);
    unsubscribe();
  });

  it('should emit to multiple subscribers', async () => {
    const element = document.createElement('button');
    const atom = addListener(element, 'click');

    const received1: Event[] = [];
    const received2: Event[] = [];
    const sub1 = atom.subscribe(ev => received1.push(ev));
    const sub2 = atom.subscribe(ev => received2.push(ev));

    element.click();
    element.click();
    await flushMicrotasks();

    expect(received1.length).toBe(2);
    expect(received2.length).toBe(2);
    expect(received1[0]).toBeInstanceOf(Event);
    expect(received2[0]).toBeInstanceOf(Event);

    sub1();
    sub2();
  });

  it('should support async subscribers', async () => {
    const element = document.createElement('button');
    const atom = addListener(element, 'click');

    const received: Event[] = [];
    const unsubscribe = atom.subscribe(async (ev) => {
      await Promise.resolve();
      received.push(ev);
    });

    element.click();
    await flushMicrotasks();

    expect(received.length).toBe(1);
    expect(received[0]).toBeInstanceOf(Event);

    unsubscribe();
  });

  it('should await async subscribers before reading next value', async () => {
    const element = document.createElement('button');
    const atom = addListener(element, 'click');

    let active = 0;
    let maxActive = 0;
    const received: Event[] = [];

    const unsubscribe = atom.subscribe(async (ev) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await delay(5);
      received.push(ev);
      active--;
    });

    element.click();
    element.click();
    await delay(20);

    expect(received.length).toBe(2);
    expect(maxActive).toBe(1);

    unsubscribe();
  });

  it('does not attach listener when unsubscribed before pending target resolves', async () => {
    const element = document.createElement('button');

    let listenerAdded = false;
    const originalAdd = element.addEventListener;
    element.addEventListener = function (...args: any[]) {
      listenerAdded = true;
      return originalAdd.apply(this, args as any);
    };

    const target$ = new Promise<EventTarget>((resolve) => {
      setTimeout(() => resolve(element), 20);
    });

    const atom = addListener(target$, Promise.resolve('click'));
    const unsubscribe = atom.subscribe(() => listenerAdded = true);

    unsubscribe();

    await delay(40);
    expect(listenerAdded).toBe(false);
    element.addEventListener = originalAdd;
  });
});
