import { onAnimationFrame, onMutation } from '@epikodelabs/streamix/dom';

describe('DOM stream observation regressions', () => {
  if (typeof document === 'undefined') {
    it('keeps the animation stream idle on the server', async () => {
      const next = jasmine.createSpy('next');
      const subscription = onAnimationFrame().subscribe(next);
      try {
        await new Promise(resolve => setTimeout(resolve, 40));
        expect(next).not.toHaveBeenCalled();
      } finally {
        await subscription.unsubscribe();
      }
    });
  } else {
    it('observes attributes when mutation options are omitted', async () => {
      const element = document.createElement('div');
      const iterator = onMutation(element)[Symbol.asyncIterator]();
      try {
        const records = iterator.next();
        element.setAttribute('data-test', 'updated');
        const result = await records;
        expect(result.value[0].attributeName).toBe('data-test');
      } finally {
        await iterator.return?.();
      }
    });

    it('reports invalid promised mutation options to the reader', async () => {
      const element = document.createElement('div');
      const iterator = onMutation(element, Promise.resolve({}))[Symbol.asyncIterator]();
      try {
        await expectAsync(iterator.next()).toBeRejectedWithError(TypeError);
      } finally {
        await iterator.return?.();
      }
    });
  }
});