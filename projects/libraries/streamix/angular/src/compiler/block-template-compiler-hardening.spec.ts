import {
  compileSxBlockTemplate,
} from './block-template-compiler';

describe('compiled structural template diagnostics', () => {
  it('supports nested property interpolation', () => {
    const result = compileSxBlockTemplate(
      '<span>{{ user.profile.name }}</span>',
    );

    expect(result.updateBody).toContain(
      'ɵsxReadLocal(context, "user.profile.name")',
    );
  });

  it('rejects executable interpolation expressions', () => {
    expect(() =>
      compileSxBlockTemplate(
        '<span>{{ format(user) }}</span>',
      ),
    ).toThrowError(/only local\/property reads/i);
  });

  it('rejects structural control flow inside a direct block', () => {
    expect(() =>
      compileSxBlockTemplate(
        '@if (visible) { <span>Visible</span> }',
      ),
    ).toThrowError(/unsupported sx structural template node/i);
  });
});
