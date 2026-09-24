import {
  emitStructuralBlock,
} from './emit-structural-block';

describe('emitStructuralBlock', () => {
  it('emits direct DOM creation for a value block', () => {
    const code = emitStructuralBlock({
      kind: 'value',
      block: 0,
      source: 'user',
      alias: 'user',
      template: '<span>Hello {{ user.name }}</span>',
    });

    expect(code).toContain('document.createElement("span")');
    expect(code).toContain('document.createTextNode("")');
    expect(code).toContain('ɵcreateSxCompiledBlock');
    expect(code).toContain('ɵcreateSxValueBlock');
    expect(code).not.toContain('innerHTML');
    expect(code).not.toContain('ɵcreateSxStaticBlock');
  });

  it('emits direct DOM creation for keyed collection records', () => {
    const code = emitStructuralBlock({
      kind: 'collection',
      block: 1,
      source: 'heroes',
      item: 'hero',
      trackBy: 'trackHero',
      template: '<li>{{ hero.name }}</li>',
    });

    expect(code).toContain('document.createElement("li")');
    expect(code).toContain('instance.update({ hero, index })');
    expect(code).toContain('ɵcreateSxKeyedBlock');
    expect(code).toContain('ctx.trackHero');
    expect(code).not.toContain('innerHTML');
  });
});
