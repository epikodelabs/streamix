import { Component } from '@angular/core';

import { StreamixFieldDirective } from './streamix-field.directive';
import {
  type FieldView,
  type ValidationIssues,
} from './streamix-forms';

const messages: Readonly<Record<string, string>> = Object.freeze({
  required: 'This field is required.',
  email: 'Use a valid email address.',
  pattern: 'Format is invalid.',
  usernameTaken: 'That username is reserved for demos.',
});

@Component({
  selector: 'app-streamix-field',
  standalone: true,
  imports: [StreamixFieldDirective],
  template: `
    <label
      class="field"
      [class.field-wide]="view.config.type === 'textarea'"
      [class.range-field]="view.config.type === 'range'"
    >
      <span>{{ view.config.label }}</span>

      @if (view.config.type === 'textarea') {
        <textarea
          [rows]="view.config.rows ?? 4"
          [sxField]="view.node"
        ></textarea>
      } @else {
        <input
          [type]="view.config.type ?? 'text'"
          [min]="view.config.min ?? null"
          [max]="view.config.max ?? null"
          [sxField]="view.node"
        />
      }

      @if (hint; as text) {
        <small class="hint">{{ text }}</small>
      }

      @if (error; as text) {
        <small class="error">{{ text }}</small>
      }
    </label>
  `,
})
export class StreamixFieldComponent {
  @Input({ required: true })
  view!: FieldView<any>;

  get hint(): string | null {
    const { node, config } = this.view;

    if (config.pendingHint && node.pending.value) {
      return config.pendingHint;
    }

    return config.hint?.(node.completeValue.value) ?? null;
  }

  get error(): string | null {
    const { node } = this.view;

    if (!node.touched.value || node.pending.value) {
      return null;
    }

    if (node.validationError.value !== null) {
      return 'Validation failed.';
    }

    return issueMessage(node.issues.value);
  }
}

function issueMessage(
  issues: ValidationIssues | null,
): string | null {
  if (!issues) return null;

  const [name, payload] = Object.entries(issues)[0] ?? [];
  if (name && messages[name]) return messages[name];

  if (
    name === 'minLength'
    || name === 'maxLength'
    || name === 'min'
    || name === 'max'
  ) {
    const required =
      typeof payload === 'object'
      && payload !== null
      && 'required' in payload
        ? String((payload as { required: unknown }).required)
        : '';

    return `${name.startsWith('max') ? 'Maximum' : 'Minimum'} ${
      name.endsWith('Length') ? 'length' : 'value'
    } is ${required}.`;
  }

  return 'Value is invalid.';
}
