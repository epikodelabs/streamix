export * from './angular-template-parser';
export * from './binding-plan';
export * from './build-transform';
export * from './component-build-adapter';
export * from './install-lifecycle';
export * from './emit-component-module';
export * from './emit-component-setup';
export * from './template-transform';
export * from './block-template-compiler';

export * from './source-resolution';

// The introspection transform is framework-neutral TypeScript instrumentation
// shared by every builder; this entry re-exports it as the Angular reference.
export * from '@epikodelabs/streamix/compiler';
