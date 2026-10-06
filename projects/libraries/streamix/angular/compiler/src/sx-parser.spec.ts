import {
  parseSxExpression,
} from './sx-parser';

describe('parseSxExpression', () => {
  it('parses value alias syntax', () => {
    expect(parseSxExpression('user as user')).toEqual({
      kind: 'value',
      source: 'user',
      alias: 'user',
    });
  });

  it('parses keyed collection syntax', () => {
    expect(
      parseSxExpression(
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
