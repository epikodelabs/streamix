import { transformVueSfc } from './compiler';

/** Mirrors the compiler's identifier-safe bridge encoding. */
function bridge(scope: string, path: string): string {
  const encode = (value: string): string =>
    [...value].map(char => char.codePointAt(0)!.toString(16).padStart(6, '0')).join('');
  return `__sx_${encode(scope)}_${encode(path)}`;
}

describe('Vue SFC compiler scope member classification', () => {
  it('bridges a nested scope value read through the nested scope', () => {
    const result = transformVueSfc(`
      <script setup lang="ts">
      import { scope } from '@epikodelabs/streamix';
      const state = scope({ profile: { name: 'Ada', age: 36 } });
      </script>
      <template><p>{{ state.profile.name }}</p></template>
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.bridgedScopes).toEqual({ state: ['profile.name'] });
    expect(result.code).toContain(
      "useScopeMember(state.get('profile').get('name'), 'state.profile.name')",
    );
    expect(result.code).toContain(`<p>{{ ${bridge('state', 'profile.name')} }}</p>`);
  });

  it('never bridges or invokes a method member', () => {
    const result = transformVueSfc(`
      <script setup lang="ts">
      import { method, scope } from '@epikodelabs/streamix';
      const state = scope({ count: 0, increment: method(self => self.count++) });
      </script>
      <template><button @click="state.increment()">{{ state.count }}</button></template>
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.bridgedScopes).toEqual({ state: ['count'] });
    expect(result.code).not.toContain("state.get('increment')");
    expect(result.code).not.toContain('useScopeMember(state.increment');
    expect(result.code).toContain('@click="state.increment()"');
    expect(result.code).toContain(
      `{{ ${bridge('state', 'count')} }}`,
    );
  });

  it('recognizes an aliased method(...) import', () => {
    const result = transformVueSfc(`
      <script setup lang="ts">
      import { method as action, scope } from '@epikodelabs/streamix';
      const state = scope({ count: 0, increment: action(self => self.count++) });
      </script>
      <template><button @click="state.increment()">{{ state.count }}</button></template>
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.code).not.toContain("state.get('increment')");
    expect(result.code).toContain('@click="state.increment()"');
  });

  it('lowers a nested scope write through the parent scope', () => {
    const result = transformVueSfc(`
      <script setup lang="ts">
      import { scope } from '@epikodelabs/streamix';
      const state = scope({ profile: { name: 'Ada' } });
      </script>
      <template><button @click="state.profile.name = 'Grace'">{{ state.profile.name }}</button></template>
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain(
      "@click=\"state.get('profile').set('name', 'Grace')\"",
    );
    expect(result.code).toContain(
      "useScopeMember(state.get('profile').get('name'), 'state.profile.name')",
    );
  });

  it('lowers v-model on a nested scope atom', () => {
    const result = transformVueSfc(`
      <script setup lang="ts">
      import { scope } from '@epikodelabs/streamix';
      const state = scope({ profile: { name: 'Ada' } });
      </script>
      <template><input v-model="state.profile.name"></template>
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain(
      `:value="${bridge('state', 'profile.name')}"`,
    );
    expect(result.code).toContain(
      "@input=\"state.get('profile').set('name', $event.target.value)\"",
    );
  });

  it('bridges the source prefix of a value member property read', () => {
    const result = transformVueSfc(`
      <script setup lang="ts">
      import { atom, scope } from '@epikodelabs/streamix';
      const state = scope({ form: atom({ name: 'Ada' }) });
      </script>
      <template><p>{{ state.form.name }}</p></template>
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.bridgedScopes).toEqual({ state: ['form'] });
    expect(result.code).toContain("useScopeMember(state.get('form'), 'state.form')");
    expect(result.code).toContain(`<p>{{ ${bridge('state', 'form')}.name }}</p>`);
  });

  it('leaves a whole nested scope reference untouched', () => {
    const result = transformVueSfc(`
      <script setup lang="ts">
      import { scope } from '@epikodelabs/streamix';
      const state = scope({ profile: { name: 'Ada' } });
      </script>
      <template><child-input :state="state.profile" /></template>
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.bridgedScopes).toEqual({ state: [] });
    expect(result.code).toContain(':state="state.profile"');
    expect(result.code).not.toContain("state.get('profile')");
  });

  it('rejects reads through a nested scope the compiler cannot inspect', () => {
    const result = transformVueSfc(`
      <script setup lang="ts">
      import { scope } from '@epikodelabs/streamix';
      const state = scope({ profile: scope(() => ({ name: 'Ada' })) });
      </script>
      <template><p>{{ state.profile.name }}</p></template>
    `);

    expect(result.bridgedScopes).toEqual({ state: [] });
    expect(result.diagnostics.length).toBe(1);
    expect(result.diagnostics[0].message).toContain('state.profile.name');
    expect(result.diagnostics[0].message).toContain('cannot inspect');
  });

  it('rejects writes to a nested scope object', () => {
    const result = transformVueSfc(`
      <script setup lang="ts">
      import { scope } from '@epikodelabs/streamix';
      const state = scope({ profile: { name: 'Ada' } });
      </script>
      <template><button @click="state.profile = 'none'">Reset</button></template>
    `);

    expect(result.diagnostics.some(item => item.message.includes('nested scope'))).toBeTrue();
  });

  it('rejects writes through an object-valued atom', () => {
    const result = transformVueSfc(`
      <script setup lang="ts">
      import { atom, scope } from '@epikodelabs/streamix';
      const state = scope({ form: atom({ name: 'Ada' }) });
      </script>
      <template><button @click="state.form.name = 'Grace'">Rename</button></template>
    `);

    expect(result.diagnostics.some(item => item.message.includes('would not emit'))).toBeTrue();
  });
});
