import { on } from '@epikodelabs/streamix/dom';
import { idescribe } from './env.spec';

idescribe('on', () => {
  it('dispatches to the correct DOM factory', async () => {
    const values: number[] = [];
    const sub = on('visibilityChange').subscribe(v => values.push(v as any));

    await new Promise(resolve => setTimeout(resolve, 0));

    expect(values.length).toBeGreaterThan(0);
    sub.unsubscribe();
  });

  it('passes parameters through to parameterized factories', async () => {
    const element = document.createElement('div');
    const values: { width: number; height: number }[] = [];
    const sub = on('resize', element).subscribe(v => values.push(v));

    await new Promise(resolve => setTimeout(resolve, 0));

    expect(values.length).toBeGreaterThan(0);
    sub.unsubscribe();
  });

  it('throws for unsupported source types', () => {
    expect(() => on('unsupportedType' as any)).toThrowError(/Unsupported DOM source type/);
  });
});
