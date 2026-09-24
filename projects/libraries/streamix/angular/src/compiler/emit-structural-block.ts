import {
  compileSxBlockTemplate,
} from './block-template-compiler';
import type {
  SxStructuralPlanEntry,
} from './structural-plan';

export function emitStructuralBlock(
  entry: SxStructuralPlanEntry,
): string {
  const compiled = compileSxBlockTemplate(
    entry.template,
    `sx-block-${entry.block}.html`,
  );

  const anchor = `sxBlock${entry.block}`;
  const factory = emitFactory(entry, compiled);

  if (entry.kind === 'value') {
    return [
      `const ${anchor} = document.createComment("sx:${entry.block}");`,
      `host.appendChild(${anchor});`,
      factory,
      `const sxStructural${entry.block} = ɵcreateSxValueBlock(`,
      `  ${anchor},`,
      `  ctx.${entry.source},`,
      `  sxFactory${entry.block},`,
      `);`,
    ].join('\n');
  }

  const trackBy = entry.trackBy
    ? `ctx.${entry.trackBy}`
    : `(_index, ${entry.item}) => ${entry.item}`;

  return [
    `const ${anchor} = document.createComment("sx:${entry.block}");`,
    `host.appendChild(${anchor});`,
    factory,
    `const sxStructural${entry.block} = ɵcreateSxKeyedBlock(`,
    `  ${anchor},`,
    `  ctx.${entry.source},`,
    `  sxFactory${entry.block},`,
    `  ${trackBy},`,
    `);`,
  ].join('\n');
}

function emitFactory(
  entry: SxStructuralPlanEntry,
  compiled: ReturnType<typeof compileSxBlockTemplate>,
): string {
  if (entry.kind === 'value') {
    const local = entry.alias ?? '$value';

    return [
      `const sxFactory${entry.block} = {`,
      `  create(${local}) {`,
      `    const context = { ${local} };`,
      indent(compiled.createBody, 4),
      emitRangeAndInstance(compiled.rootNodes, compiled.updateBody, 4),
      `  },`,
      `  update(instance, ${local}) {`,
      `    instance.update({ ${local} });`,
      `  },`,
      `};`,
    ].join('\n');
  }

  return [
    `const sxFactory${entry.block} = {`,
    `  create(${entry.item}, index) {`,
    `    const context = { ${entry.item}, index };`,
    indent(compiled.createBody, 4),
    emitRangeAndInstance(compiled.rootNodes, compiled.updateBody, 4),
    `  },`,
    `  update(instance, ${entry.item}, index) {`,
    `    instance.update({ ${entry.item}, index });`,
    `  },`,
    `};`,
  ].join('\n');
}

function emitRangeAndInstance(
  rootNodes: readonly string[],
  updateBody: string,
  spaces: number,
): string {
  const pad = ' '.repeat(spaces);
  const inner = ' '.repeat(spaces + 2);
  const roots = `[${rootNodes.join(', ')}]`;

  return [
    `${pad}const range = ɵcreateSxFragmentRange(${roots});`,
    `${pad}return ɵcreateSxCompiledBlock(`,
    `${inner}range.first,`,
    `${inner}range.last,`,
    `${inner}(context) => {`,
    indent(updateBody, spaces + 4),
    `${inner}},`,
    `${inner}context,`,
    `${pad});`,
  ].join('\n');
}

function indent(
  source: string,
  spaces: number,
): string {
  if (!source) return '';

  const prefix = ' '.repeat(spaces);

  return source
    .split('\n')
    .map(line => `${prefix}${line}`)
    .join('\n');
}
