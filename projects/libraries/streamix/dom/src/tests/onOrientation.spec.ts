import { onOrientation } from "@epikodelabs/streamix/dom";
import { idescribe } from "./env.spec";

idescribe('onOrientation', () => {
  let originalOrientation: any;
  let mockOrientation: any;

  beforeEach(() => {
    // Save original
    originalOrientation = Object.getOwnPropertyDescriptor(window.screen, 'orientation');

    // Create a more complete mock
    mockOrientation = {
      angle: 0,
      type: 'portrait-primary',
      addEventListener: jasmine.createSpy('addEventListener'),
      removeEventListener: jasmine.createSpy('removeEventListener'),
    };

    // Mock screen.orientation
    Object.defineProperty(window.screen, 'orientation', {
      configurable: true,
      value: mockOrientation,
    });
  });

  afterEach(() => {
    // Restore original
    if (originalOrientation) {
      Object.defineProperty(window.screen, 'orientation', originalOrientation);
    } else {
      // @ts-ignore
      delete window.screen.orientation;
    }
  });

  it('should emit initial orientation immediately', (done) => {
    const stream = onOrientation();
    const subscription = stream.subscribe({
      next: (value) => {
        try {
          expect(value).toBe('portrait');
        } catch (err: any) {
          done.fail(err);
        }
      },
    });
    subscription.unsubscribe();
    done();
  });

  it('should emit a new value on orientation change', (done) => {
    const stream = onOrientation();
    const addListenerSpy = (window.screen.orientation.addEventListener as jasmine.Spy);

    // Get the callback that was registered
    let changeCallback: () => void;
    addListenerSpy.and.callFake((event: string, callback: () => void) => {
      if (event === 'change') {
        changeCallback = callback;
      }
    });

    let callCount = 0;
    const subscription = stream.subscribe({
      next: (value: any) => {
        callCount++;
        try {
          if (callCount === 1) {
            expect(value).toBe('portrait'); // initial

            // Simulate orientation change to landscape
            setTimeout(() => {
                mockOrientation.angle = 90;
                mockOrientation.type = 'landscape-primary';
    
                // Trigger the change event
                if (changeCallback) changeCallback();
            }, 0);
          } else if (callCount === 2) {
            expect(value).toBe('landscape');
            subscription.unsubscribe();
            done();
          }
        } catch (err: any) {
          done.fail(err);
        }
      },
    });
  });

  it('should handle different orientation angles and types', (done) => {
    // Test landscape with angle 90
    mockOrientation.angle = 90;
    mockOrientation.type = 'landscape-primary';

    const stream = onOrientation();
    const subscription = stream.subscribe({
      next: (value) => {
        try {
          expect(value).toBe('landscape');
        } catch (err: any) {
          done.fail(err);
        }
      },
    });
    subscription.unsubscribe();
    done();
  });

  it('should clean up event listeners on unsubscribe', () => {
    const stream = onOrientation();
    const subscription = stream.subscribe(() => { });

    const removeListenerSpy = (window.screen.orientation.removeEventListener as jasmine.Spy);

    subscription.unsubscribe();

    expect(removeListenerSpy).toHaveBeenCalledWith('change', jasmine.any(Function));
  });

  it('should share the same listener across multiple subscribers', () => {
    const stream = onOrientation();
    const addListenerSpy = window.screen.orientation.addEventListener as jasmine.Spy;

    const sub1 = stream.subscribe(() => { });
    const sub2 = stream.subscribe(() => { });

    // Should only add listener once
    expect(addListenerSpy).toHaveBeenCalledTimes(1);

    sub1.unsubscribe();
    // Should not remove yet
    expect((window.screen.orientation.removeEventListener as jasmine.Spy))
      .not.toHaveBeenCalled();

    sub2.unsubscribe();
    // Now should remove
    expect((window.screen.orientation.removeEventListener as jasmine.Spy))
      .toHaveBeenCalledTimes(1);
  });
});

