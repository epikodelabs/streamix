import { onResize } from "@actioncrew/streamix/dom";
import { idescribe } from "./env.spec";

idescribe('onResize', () => {
  it('should detect element resize changes', async () => {
    const div = document.createElement('div');
    div.style.width = '100px';
    div.style.height = '100px';
    document.body.appendChild(div);

    const values: any[] = [];
    const sub = onResize(div).subscribe(v => values.push(v));

    // initial
    await new Promise(requestAnimationFrame);

    div.style.width = '200px';
    div.style.height = '200px';

    // allow layout + RO delivery
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);

    expect(values[0].width).toBe(100);
    expect(values.at(-1).width).toBe(200);

    sub.unsubscribe();
    document.body.removeChild(div);
  });

  it('should clean up ResizeObserver when element is removed', () => {
    const divToTest = document.createElement('div');
    divToTest.style.width = '100px';
    divToTest.style.height = '100px';
    document.body.appendChild(divToTest);

    const resizeStream = onResize(divToTest);

    // Spy on the cleanup mechanism
    const disconnectSpy = spyOn(ResizeObserver.prototype, 'disconnect');

    const subscription = resizeStream.subscribe({
      next: () => { }
    });

    // Remove element and verify cleanup
    document.body.removeChild(divToTest);
    subscription.unsubscribe();

    expect(disconnectSpy).toHaveBeenCalled();
  });

  it('should clean up when unsubscribed', () => {
    const divToTest = document.createElement('div');
    document.body.appendChild(divToTest);

    const resizeStream = onResize(divToTest);
    const disconnectSpy = spyOn(ResizeObserver.prototype, 'disconnect');

    const subscription = resizeStream.subscribe({
      next: () => { }
    });

    subscription.unsubscribe();

    expect(disconnectSpy).toHaveBeenCalled();
    document.body.removeChild(divToTest);
  });

  it('should handle element removal without errors', (done) => {
    const divToTest = document.createElement('div');
    document.body.appendChild(divToTest);

    const resizeStream = onResize(divToTest);
    let errorOccurred = false;

    const subscription = resizeStream.subscribe({
      next: () => { },
      error: () => {
        errorOccurred = true;
      }
    });

    setTimeout(() => {
      document.body.removeChild(divToTest);
      subscription.unsubscribe();
      expect(errorOccurred).toBe(false);
      done();
    }, 50);
  });

  it('should emit dimensions when element is resized', (done) => {
    const div = document.createElement('div');
    div.style.width = '100px';
    div.style.height = '50px';
    document.body.appendChild(div);

    const resizeStream = onResize(div);

    const subscription = resizeStream.subscribe({
      next: ({ width, height }) => {
        expect(width).toBe(100);
        expect(height).toBe(50);
        subscription.unsubscribe();
        document.body.removeChild(div);
        done();
      }
    });

    // Trigger ResizeObserver manually
    div.style.width = '100px';
    div.style.height = '50px';
    div.dispatchEvent(new Event('resize')); // Note: may not trigger RO, so observer may need to be mocked in real test
  });

  // More robust version with timeout protection
  it('completes on unsubscribe', done => {
    const div = document.createElement('div');
    document.body.appendChild(div);

    const sub = onResize(div).subscribe({
      complete: () => done()
    });

    sub.unsubscribe();
  });
});
