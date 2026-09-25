import {
  indent,
} from './codegen';
import {
  emitStructuralBlock,
} from './emit-structural-block';
import type {
  SxStructuralPlan,
} from './structural-plan';

export function emitStructuralModule(
  plan: SxStructuralPlan,
  functionName = 'ɵsetupSxStructuralBlocks',
): string {
  const blocks = plan.blocks
    .map(entry => emitStructuralBlock(entry))
    .join('\n\n');

  const destroys = plan.blocks
    .map(entry => `  sxStructural${entry.block}.destroy();`)
    .join('\n');

  return [
    `import {`,
    `  ɵcreateSxCompiledBlock,`,
    `  ɵcreateSxFragmentRange,`,
    `  ɵcreateSxKeyedBlock,`,
    `  ɵcreateSxValueBlock,`,
    `  ɵsxReadLocal,`,
    `  ɵsxString,`,
    `} from '@epikodelabs/streamix/angular';`,
    ``,
    `export function ${functionName}(`,
    `  host: Element,`,
    `  ctx: any,`,
    `) {`,
    indent(blocks, 2),
    ``,
    `  return {`,
    `    destroy() {`,
    destroys,
    `    },`,
    `  };`,
    `}`,
    ``,
  ].join('\n');
}
