import {
  createOperator,
  createPushOperator,
  DONE,
  isOperator,
  isPromiseLike,
  NEXT,
} from '@epikodelabs/streamix';

describe('operator helpers', () => {
  it('should detect thenables and operator objects', () => {
    const operator = createOperator<number>('identity', source => source as AsyncIterator<number>);

    expect(isPromiseLike({ then() {} })).toBe(true);
    expect(isPromiseLike(null)).toBe(false);
    expect(isOperator(operator)).toBe(true);
    expect(isOperator({ type: 'operator' })).toBe(false);
  });

  it('should forward source return results through default operator return()', async () => {
    const source: AsyncIterator<number> = {
      next: async () => DONE,
      return: async value => ({ done: true, value }),
    };

    const operator = createOperator<number>('identity', src => ({
      next: () => src.next(),
    }));

    const iterator = operator.apply(source);

    await expectAsync(iterator.return?.('done')!).toBeResolvedTo({ done: true, value: 'done' });
  });

  it('should fall back to the caller value and warn when source return cleanup fails', async () => {
    const warn = spyOn(console, 'warn');
    const source: AsyncIterator<number> = {
      next: async () => DONE,
      return: async () => {
        throw new Error('cleanup failed');
      },
    };

    const operator = createOperator<number>('identity', src => ({
      next: () => src.next(),
    }));

    const iterator = operator.apply(source);
    const result = await iterator.return?.('fallback');

    expect(result).toEqual({ done: true, value: 'fallback' });
    expect(warn).toHaveBeenCalled();
  });

  it('should forward non-done results returned by source.throw()', async () => {
    const source: AsyncIterator<number> = {
      next: async () => DONE,
      throw: async () => NEXT(99),
    };

    const operator = createOperator<number, number>('identity', src => ({
      next: () => src.next() as Promise<IteratorResult<number>>,
    }));

    const iterator = operator.apply(source);

    await expectAsync(iterator.throw?.(new Error('boom'))!).toBeResolvedTo(NEXT(99));
  });

  it('should resolve default throw() to DONE when the source handles the error and completes', async () => {
    const source: AsyncIterator<number> = {
      next: async () => DONE,
      throw: async () => DONE,
    };

    const operator = createOperator<number>('identity', src => ({
      next: () => src.next(),
    }));

    const iterator = operator.apply(source);

    await expectAsync(iterator.throw?.(new Error('boom'))!).toBeResolvedTo(DONE);
  });

  it('should preserve custom iterator return and throw implementations', async () => {
    const source: AsyncIterator<number> = {
      next: async () => DONE,
      return: jasmine.createSpy('sourceReturn').and.resolveTo({ done: true, value: 'source' }),
      throw: jasmine.createSpy('sourceThrow').and.resolveTo(DONE),
    };

    const customReturn = jasmine.createSpy('customReturn').and.resolveTo({ done: true, value: 'custom' });
    const customThrow = jasmine.createSpy('customThrow').and.resolveTo(NEXT(7));

    const operator = createOperator<number>('identity', () => ({
      next: () => source.next(),
      return: customReturn,
      throw: customThrow,
    }));

    const iterator = operator.apply(source);

    await expectAsync(iterator.return?.('ignored')!).toBeResolvedTo({ done: true, value: 'custom' });
    await expectAsync(iterator.throw?.('ignored')!).toBeResolvedTo(NEXT(7));

    expect(customReturn).toHaveBeenCalled();
    expect(customThrow).toHaveBeenCalled();
    expect(source.return).not.toHaveBeenCalled();
    expect(source.throw).not.toHaveBeenCalled();
  });

  it('should rethrow the original error after throw cleanup', async () => {
    const warn = spyOn(console, 'warn');
    const source: AsyncIterator<number> = {
      next: async () => DONE,
      throw: async () => {
        throw new Error('different error');
      },
      return: async () => {
        throw new Error('return cleanup failed');
      },
    };

    const operator = createOperator<number>('identity', src => ({
      next: () => src.next(),
    }));

    const iterator = operator.apply(source);

    await expectAsync(iterator.throw?.('boom')!).toBeRejectedWithError('boom');
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('should normalize non-Error throw values in default operator throw()', async () => {
    const source: AsyncIterator<number> = {
      next: async () => DONE,
      return: async () => DONE,
    };

    const operator = createOperator<number>('identity', src => ({
      next: () => src.next(),
    }));

    const iterator = operator.apply(source);

    await expectAsync(iterator.throw?.('boom')!).toBeRejectedWithError('boom');
  });

  it('should run push-operator cleanup once and ignore pushes after return()', async () => {
    let cleanupCalls = 0;
    let outputRef: { push(value: number): void | Promise<void> } | undefined;
    const source: AsyncIterator<number> = {
      next: async () => DONE,
      return: jasmine.createSpy('return').and.resolveTo(DONE),
    };

    const operator = createPushOperator<number>('pusher', (_source, output) => {
      outputRef = output;
      output.push(1);

      return () => {
        cleanupCalls++;
        output.push(2);
      };
    });

    const iterator = operator.apply(source);

    await expectAsync(iterator.next()).toBeResolvedTo(NEXT(1));
    await expectAsync(iterator.return?.('ignored')!).toBeResolvedTo(DONE);

    outputRef?.push(3);

    await expectAsync(iterator.next()).toBeResolvedTo(DONE);
    expect(cleanupCalls).toBe(1);
    expect((source.return as jasmine.Spy)).toHaveBeenCalledTimes(1);
  });

  it('should reject push-operator throws and warn when cleanup paths fail', async () => {
    const warn = spyOn(console, 'warn');
    const source: AsyncIterator<number> = {
      next: async () => DONE,
      return: async () => {
        throw new Error('source return failed');
      },
    };

    const operator = createPushOperator<number>('pusher', () => {
      return () => {
        throw new Error('cleanup failed');
      };
    });

    const iterator = operator.apply(source);

    await expectAsync(iterator.throw?.('kaboom')!).toBeRejectedWithError('kaboom');
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('should handle push operators without cleanup callbacks', async () => {
    const source: AsyncIterator<number> = {
      next: async () => DONE,
      return: jasmine.createSpy('return').and.resolveTo(DONE),
    };

    const operator = createPushOperator<number>('pusher', (_source, output) => {
      output.push(1);
    });

    const iterator = operator.apply(source);

    await expectAsync(iterator.next()).toBeResolvedTo(NEXT(1));
    await expectAsync(iterator.return?.('done')!).toBeResolvedTo(DONE);
    expect((source.return as jasmine.Spy)).toHaveBeenCalledTimes(1);
  });

  it('should await push-operator cleanup before calling source.return()', async () => {
    const events: string[] = [];
    const source: AsyncIterator<number> = {
      next: async () => DONE,
      return: async () => {
        events.push('source:return');
        return DONE;
      },
    };

    const operator = createPushOperator<number>('pusher', (_source, output) => {
      output.push(1);
      return async () => {
        events.push('cleanup:start');
        await Promise.resolve();
        events.push('cleanup:end');
      };
    });

    const iterator = operator.apply(source);

    await expectAsync(iterator.next()).toBeResolvedTo(NEXT(1));
    await expectAsync(iterator.return?.('done')!).toBeResolvedTo(DONE);
    expect(events).toEqual(['cleanup:start', 'cleanup:end', 'source:return']);
  });

  it('should warn when source.return() throws during push-operator return()', async () => {
    const warn = spyOn(console, 'warn');
    const source: AsyncIterator<number> = {
      next: async () => DONE,
      return: async () => {
        throw new Error('return failed');
      },
    };

    const operator = createPushOperator<number>('pusher', (_source, output) => {
      output.push(1);
    });

    const iterator = operator.apply(source);

    await expectAsync(iterator.next()).toBeResolvedTo(NEXT(1));
    await expectAsync(iterator.return?.('done')!).toBeResolvedTo(DONE);
    expect(warn).toHaveBeenCalled();
  });
});
