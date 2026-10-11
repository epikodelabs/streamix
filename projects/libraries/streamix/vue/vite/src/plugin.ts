import type { Plugin } from 'vite';
import {
  transformVueSfc,
  formatVueSfcDiagnostics,
} from '@epikodelabs/streamix/vue/compiler';

export interface StreamixVueViteOptions {
  /** Optional filter for SFC module ids; node_modules is always excluded. */
  readonly include?: (id: string) => boolean;
}

/**
 * Native Vite host for the Streamix Vue compiler. Put this plugin before the
 * Vue plugin so Streamix transforms authored SFCs and the Vue compiler sees
 * the bridged bindings.
 *
 * Raw atoms, deriveds, flows, and scopes declared in `<script setup>` are
 * adopted automatically: templates read and write them as ordinary Vue state
 * while Streamix stays the single owner of the values.
 *
 * Source maps preserve authored locations, and intentionally leave generated
 * bridge declarations and imports unmapped. Vite composes this map with Vue's.
 */
export function sxVue(options: StreamixVueViteOptions = {}): Plugin {
  return {
    name: 'streamix-vue',
    enforce: 'pre',
    transform(source, id) {
      const fileName = id.replace(/[?#].*$/, '');

      if (!fileName.endsWith('.vue') || fileName.includes('/node_modules/')) {
        return null;
      }

      if (options.include && !options.include(fileName)) {
        return null;
      }

      // Attribute order is intentionally unconstrained: both `<script setup
      // lang="ts">` and `<script lang="ts" setup>` are standard SFCs.
      if (!/<script\b[^>]*\bsetup\b[^>]*>/i.test(source) || !/<template\b/i.test(source)) {
        return null;
      }

      const result = transformVueSfc(source, fileName);

      for (const warning of result.diagnostics.filter(item => item.category === 'warning')) {
        this.warn(formatVueSfcDiagnostics(source, fileName, [warning]));
      }

      const errors = result.diagnostics.filter(diagnostic => diagnostic.category === 'error');

      if (errors.length > 0) {
        this.error(formatVueSfcDiagnostics(source, fileName, errors));
      }

      if (result.bindingCount === 0) {
        return null;
      }

      return { code: result.code, map: result.sourceMap ?? null };
    },
  };
}
