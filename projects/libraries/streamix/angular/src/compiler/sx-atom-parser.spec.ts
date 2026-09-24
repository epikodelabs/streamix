import {
  parseSxAtomExpression,
} from './sx-atom-parser';

describe('parseSxAtomExpression', () => {
  it('parses value alias syntax', () => {
    expect(parseSxAtomExpression('user as user')).toEqual({
      kind: 'value',
      source: 'user',
      alias: 'user',
    });
  });

  it('parses keyed collection syntax', () => {
    expect(
      parseSxAtomExpression(
        'let hero of heroes; trackBy: trackHero',
      ),
    ).toEqual({
      kind: 'collection',
      item: 'hero',
      source: 'heroes',
      trackBy: 'trackHero',
    });
  });
});
