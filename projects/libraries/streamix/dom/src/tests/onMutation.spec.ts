import { onMutation } from '@epikodelabs/streamix/dom';
import { idescribe } from './env.spec';

// Mock DOM element for testing purposes
let observedElement: HTMLDivElement;

idescribe('onMutation', () => {
  beforeEach(function() {
    // Skip all tests if MutationObserver is not available
    if (typeof MutationObserver === 'undefined') {
      this.skip();
      return;
    }
    // Create a DOM element for testing
    observedElement = document.createElement('div');
    document.body.appendChild(observedElement); // Attach to DOM
  });

  afterEach(() => {
    // Cleanup after each test
    document.body.removeChild(observedElement);
  });

  it('should emit mutations when child is added', (done) => {
    const mutationStream = onMutation(observedElement, {
      childList: true,
    });

    const subscription = mutationStream.subscribe({
      next: (mutations: any) => {
        expect(mutations.length).toBeGreaterThan(0);
        expect(mutations[0].type).toBe('childList');
        expect(mutations[0].addedNodes.length).toBe(1);
        subscription.unsubscribe();
        done();
      },
    });

    // Trigger DOM change
    setTimeout(() => {
      const newDiv = document.createElement('div');
      newDiv.innerText = 'Child div added';
      observedElement.appendChild(newDiv);
    }, 100)
  });

  it('should emit mutations when child is removed', (done) => {
    const child = document.createElement('div');
    child.innerText = 'Child div to remove';
    observedElement.appendChild(child);

    const mutationStream = onMutation(observedElement, {
      childList: true,
    });

    const subscription = mutationStream.subscribe({
      next: (mutations: any) => {
        expect(mutations.length).toBeGreaterThan(0);
        expect(mutations[0].type).toBe('childList');
        expect(mutations[0].removedNodes.length).toBe(1);
        subscription.unsubscribe();
        done();
      },
    });

    // Trigger DOM change
    setTimeout(() => {
      observedElement.removeChild(child);
    }, 100)
  });

  it('should detect subtree changes', (done) => {
    const nestedParent = document.createElement('div');
    observedElement.appendChild(nestedParent);

    const nestedChild = document.createElement('div');
    nestedChild.innerText = 'Nested change';
    nestedParent.appendChild(nestedChild);

    const mutationStream = onMutation(observedElement, {
      subtree: true,
      childList: true,
    });

    const subscription = mutationStream.subscribe({
      next: (mutations: any[]) => {
        console.log('Mutations observed:', mutations);
        try {
          expect(mutations.length).toBe(1);
          expect(mutations[0].type).toBe('childList');
          expect(mutations[0].addedNodes.length).toBe(1);
          subscription.unsubscribe();
          done();
        } catch (error: any) {
          done.fail(error);
        }
      },
    });

    // Wait until the DOM mutation happens AFTER observer is initialized
    setTimeout(() => {
      const newChild = document.createElement('div');
      newChild.innerText = 'Child added dynamically';
      nestedParent.appendChild(newChild);
    }, 100);
  });

  it('should resolve promised element and options before observing', (done) => {
    const elementPromise = Promise.resolve(observedElement);
    const optionsPromise = Promise.resolve({ attributes: true });

    const mutationStream = onMutation(elementPromise, optionsPromise);
    const subscription = mutationStream.subscribe({
      next: (mutations: MutationRecord[]) => {
        try {
          expect(mutations.some(m => m.type === 'attributes')).toBeTrue();
          expect(mutations.some(m => m.attributeName === 'data-test')).toBeTrue();
          subscription.unsubscribe();
          done();
        } catch (error: any) {
          done.fail(error);
        }
      },
    });

    setTimeout(() => {
      observedElement.setAttribute('data-test', 'async-value');
    }, 100);
  });

  it('should no-op when MutationObserver is unavailable', (done) => {
    const savedObserver = (globalThis as any).MutationObserver;
    (globalThis as any).MutationObserver = undefined;

    const mutationStream = onMutation(observedElement, { childList: true });
    const subscription = mutationStream.subscribe({
      next: () => fail('Should not emit without MutationObserver'),
    });

    setTimeout(() => {
      observedElement.appendChild(document.createElement('span'));
      subscription.unsubscribe();
      (globalThis as any).MutationObserver = savedObserver;
      done();
    }, 150);
  });
});


