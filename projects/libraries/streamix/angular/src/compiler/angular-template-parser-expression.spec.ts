import {
  parseSxTemplate,
} from './angular-template-parser';

describe('sx source expression diagnostics', () => {
  it('accepts DependencySource property paths', () => {
    const parsed = parseSxTemplate(
      '<span [sx.text]="model.count"></span>',
    );

    expect(parsed.plan.size).toBe(1);
  });

  it('rejects calls and arbitrary Angular expressions', () => {
    expect(() =>
      parseSxTemplate(
        '<span [sx.text]="getCount()"></span>',
      ),
    ).toThrowError(/require a component property path/i);

    expect(() =>
      parseSxTemplate(
        '<span [sx.text]="enabled ? yes : no"></span>',
      ),
    ).toThrowError(/require a component property path/i);
  });
});
