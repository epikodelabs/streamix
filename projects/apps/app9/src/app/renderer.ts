import type { Atom, Writable } from '@epikodelabs/streamix';

type Cleanup = () => void;
type Ctx = Record<string, any>;

function evaluate(expr: string, ctx: Ctx): any {
    const keys = Object.keys(ctx);
    try {
        const fn = new Function(...keys, `return (${expr});`);
        return fn(...keys.map(k => ctx[k]));
    } catch {
        return undefined;
    }
}

function getValue(x: any): any {
    return x && typeof x === 'object' && 'value' in x ? x.value : x;
}

function resolvePath(ctx: Ctx, path: string): { parent: any; key: string } {
    const parts = path.trim().split('.');
    const key = parts.pop()!;
    const parent = parts.reduce((obj, k) => obj?.[k], ctx);
    return { parent, key };
}

function isAtom(x: any): x is Atom<any> {
    return x && typeof x === 'object' && typeof x.subscribe === 'function';
}

function deepProxy<T>(value: T, touched: Set<Atom<any>>): T {
    if (isAtom(value)) {
        return new Proxy(value, {
            get(target, prop) {
                if (prop === 'value') touched.add(target);
                return deepProxy((target as any)[prop], touched);
            }
        }) as T;
    }
    if (Array.isArray(value)) {
        return value.map(item => deepProxy(item, touched)) as T;
    }
    if (value && typeof value === 'object') {
        return new Proxy(value, {
            get(target, prop) {
                // Scope loading is now the loading atom itself; track it and
                // return the boolean value so templates can use `scope.loading`
                // without `.value`.
                if (prop === 'loading' && isAtom((target as any).loading)) {
                    const loadingAtom = (target as any).loading as Atom<any>;
                    touched.add(loadingAtom);
                    return deepProxy(loadingAtom.value, touched);
                }
                return deepProxy((target as any)[prop], touched);
            }
        }) as T;
    }
    return value;
}

function watch(expr: string, ctx: Ctx, cb: (value: any) => void): Cleanup {
    const value = () => getValue(evaluate(expr, ctx));
    const readAtoms = () => {
        const touched = new Set<Atom<any>>();
        const proxyCtx: Ctx = {};
        for (const key of Object.keys(ctx)) {
            proxyCtx[key] = deepProxy(ctx[key], touched);
        }
        getValue(evaluate(expr, proxyCtx));
        return touched;
    };

    const touched = readAtoms();
    cb(value());

    const subs: Cleanup[] = [];
    touched.forEach(atom => {
        const sub = atom.subscribe(() => cb(value()));
        subs.push(() => sub.unsubscribe());
    });

    return () => subs.forEach(fn => fn());
}

export class ReactiveRenderer {
    private cleanups: Cleanup[] = [];

    render(template: string, ctx: Ctx, container: HTMLElement): void {
        const tpl = document.createElement('template');
        tpl.innerHTML = template.trim();
        const fragment = tpl.content;

        this.walk(fragment, ctx);
        container.appendChild(fragment);
    }

    destroy(): void {
        this.cleanups.forEach(fn => fn());
        this.cleanups = [];
    }

    private walk(parent: Node, ctx: Ctx): void {
        const nodes = Array.from(parent.childNodes);
        for (const node of nodes) {
            if (node.nodeType === Node.TEXT_NODE) {
                this.bindText(node as Text, ctx);
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                const el = node as HTMLElement;
                const ifExpr = el.getAttribute('if');
                if (ifExpr) {
                    this.bindIf(el, ifExpr, ctx);
                    continue;
                }

                const forExpr = el.getAttribute('for');
                if (forExpr && el.tagName === 'TEMPLATE') {
                    this.bindFor(el as HTMLTemplateElement, forExpr, ctx);
                    continue;
                }

                this.bindElement(el, ctx);
                this.walk(el, ctx);
            }
        }
    }

    private bindText(node: Text, ctx: Ctx): void {
        const text = node.textContent || '';
        const parts: Array<{ type: 'text' | 'expr'; value: string }> = [];
        const regex = /\{\{\s*(.*?)\s*\}\}/g;
        let last = 0;
        let match: RegExpExecArray | null;

        while ((match = regex.exec(text)) !== null) {
            if (match.index > last) {
                parts.push({ type: 'text', value: text.slice(last, match.index) });
            }
            parts.push({ type: 'expr', value: match[1] });
            last = regex.lastIndex;
        }
        if (last < text.length) {
            parts.push({ type: 'text', value: text.slice(last) });
        }

        if (parts.length === 0) return;

        const markers: Text[] = [];
        const parent = node.parentNode!;
        for (const part of parts) {
            const marker = document.createTextNode('');
            markers.push(marker);
            parent.insertBefore(marker, node);
            if (part.type === 'text') {
                marker.textContent = part.value;
            } else {
                this.cleanups.push(watch(part.value, ctx, v => {
                    marker.textContent = v == null ? '' : String(v);
                }));
            }
        }
        parent.removeChild(node);
    }

    private bindElement(el: HTMLElement, ctx: Ctx): void {
        // Attributes [attr] or bind-attr
        for (const attr of Array.from(el.attributes)) {
            const name = attr.name;
            const value = attr.value;

            if (name.startsWith('[') && name.endsWith(']')) {
                const target = name.slice(1, -1);
                this.bindAttr(el, target, value, ctx);
                el.removeAttribute(name);
            } else if (name.startsWith('bind-')) {
                const target = name.slice(5);
                this.bindAttr(el, target, value, ctx);
                el.removeAttribute(name);
            } else if (name.startsWith('(') && name.endsWith(')')) {
                const event = name.slice(1, -1);
                this.bindEvent(el, event, value, ctx);
                el.removeAttribute(name);
            } else if (name.startsWith('on-')) {
                const event = name.slice(3);
                this.bindEvent(el, event, value, ctx);
                el.removeAttribute(name);
            } else if (name === 'model') {
                this.bindModel(el, value, ctx);
                el.removeAttribute(name);
            }
        }
    }

    private bindAttr(el: HTMLElement, target: string, expr: string, ctx: Ctx): void {
        if (target.startsWith('class.')) {
            const className = target.slice(6);
            this.cleanups.push(watch(expr, ctx, v => el.classList.toggle(className, !!v)));
        } else if (target.startsWith('style.')) {
            const rest = target.slice(6);
            const dot = rest.lastIndexOf('.');
            const prop = dot >= 0 ? rest.slice(0, dot) : rest;
            const unit = dot >= 0 ? rest.slice(dot + 1) : '';
            this.cleanups.push(watch(expr, ctx, v => {
                if (v == null) (el.style as any)[prop] = '';
                else (el.style as any)[prop] = String(v) + (unit || '');
            }));
        } else if (target === 'text') {
            this.cleanups.push(watch(expr, ctx, v => el.textContent = v == null ? '' : String(v)));
        } else if (target === 'innerhtml' || target === 'innerHTML') {
            this.cleanups.push(watch(expr, ctx, v => el.innerHTML = v == null ? '' : String(v)));
        } else {
            this.cleanups.push(watch(expr, ctx, v => {
                if (v == null || v === false) el.removeAttribute(target);
                else el.setAttribute(target, String(v));
            }));
        }
    }

    private bindEvent(el: HTMLElement, event: string, handlerExpr: string, ctx: Ctx): void {
        const handler = evaluate(handlerExpr, ctx);
        if (typeof handler !== 'function') return;
        el.addEventListener(event, handler);
        this.cleanups.push(() => el.removeEventListener(event, handler));
    }

    private bindModel(el: HTMLElement, path: string, ctx: Ctx): void {
        const { parent, key } = resolvePath(ctx, path);
        let atom = parent?.[key] as Writable<any>;
        // Scope proxies return atom values, not atoms. Use scope.at(key) to reach
        // the underlying writable atom for two-way binding.
        if (!isAtom(atom) && typeof parent?.at === 'function') {
            atom = parent.at(key);
        }
        if (!atom || typeof atom.next !== 'function') return;

        const input = el as HTMLInputElement | HTMLSelectElement;
        const isCheckbox = input instanceof HTMLInputElement && input.type === 'checkbox';
        const isRadio = input instanceof HTMLInputElement && input.type === 'radio';

        this.cleanups.push(watch(path, ctx, v => {
            if (isCheckbox) {
                (input as HTMLInputElement).checked = !!v;
            } else if (isRadio) {
                (input as HTMLInputElement).checked = input.value === v;
            } else if (input.value !== String(v == null ? '' : v)) {
                input.value = v == null ? '' : String(v);
            }
        }));

        const listener = () => {
            if (isCheckbox) atom.next((input as HTMLInputElement).checked);
            else if (!isRadio || (input as HTMLInputElement).checked) atom.next(input.value);
        };
        input.addEventListener('input', listener);
        input.addEventListener('change', listener);
        this.cleanups.push(() => {
            input.removeEventListener('input', listener);
            input.removeEventListener('change', listener);
        });
    }

    private bindIf(el: HTMLElement, expr: string, ctx: Ctx): void {
        const parent = el.parentNode!;
        const anchor = document.createComment('if');
        parent.insertBefore(anchor, el);
        let current: HTMLElement | null = null;
        let childCtx = ctx;

        this.cleanups.push(watch(expr, ctx, v => {
            if (v) {
                if (!current) {
                    current = el.cloneNode(true) as HTMLElement;
                    current.removeAttribute('if');
                    this.bindElement(current, childCtx);
                    this.walk(current, childCtx);
                    parent.insertBefore(current, anchor);
                }
            } else {
                if (current) {
                    parent.removeChild(current);
                    current = null;
                }
            }
        }));
        parent.removeChild(el);
    }

    private bindFor(tplEl: HTMLTemplateElement, expr: string, ctx: Ctx): void {
        const parent = tplEl.parentNode!;
        const anchor = document.createComment('for');
        parent.insertBefore(anchor, tplEl);

        const [itemName, , arrayExpr] = expr.split(/\s+/);
        const itemsAtom = evaluate(arrayExpr, ctx);

        let rows: { el: HTMLElement; cleanups: Cleanup[] }[] = [];

        const renderItems = (items: any[]) => {
            // Remove old rows
            for (const row of rows) {
                row.el.parentNode?.removeChild(row.el);
                row.cleanups.forEach(fn => fn());
            }
            rows = [];

            if (!Array.isArray(items)) return;

            for (const item of items) {
                const el = tplEl.content.firstElementChild?.cloneNode(true) as HTMLElement;
                if (!el) continue;
                const childCtx = { ...ctx, [itemName]: item };
                const cleanups: Cleanup[] = [];

                // Temporarily replace this.cleanups
                const prev = this.cleanups;
                this.cleanups = cleanups;
                this.bindElement(el, childCtx);
                this.walk(el, childCtx);
                this.cleanups = prev;

                parent.insertBefore(el, anchor);
                rows.push({ el, cleanups });
            }
        };

        if (isAtom(itemsAtom)) {
            const sub = itemsAtom.subscribe((items: any) => renderItems(items));
            this.cleanups.push(() => sub.unsubscribe());
            renderItems(getValue(itemsAtom));
        } else {
            renderItems(itemsAtom);
        }

        parent.removeChild(tplEl);
    }
}
