
export interface ScrollPosition {
  readonly x: number;
  readonly y: number;
}

export interface HistoryEntry {
  readonly href: string;
  readonly scroll: ScrollPosition;
  readonly state: unknown;
}

export interface HistoryUpdate {
  readonly type: 'none' | 'push' | 'replace' | 'popstate';
  readonly previousIndex: number;
  readonly nextIndex: number;
  readonly previousEntry?: HistoryEntry;
  readonly previousScroll: ScrollPosition;
  readonly nextEntry?: HistoryEntry;
}

export const ZERO_SCROLL: ScrollPosition = Object.freeze({ x: 0, y: 0 });

export class HistoryManager {
  private entries: HistoryEntry[] = [];
  private index = -1;

  private get currentHref(): string {
    return window.location.pathname + window.location.search + window.location.hash;
  }

  private readScroll(): ScrollPosition {
    return {
      x: window.scrollX,
      y: window.scrollY,
    };
  }

  private readHistoryState(): unknown {
    return window.history.state ?? null;
  }

  private ensureHistoryEntry(): void {
    if (this.entries.length > 0) {
      return;
    }

    this.entries = [{
      href: this.currentHref,
      scroll: this.readScroll(),
      state: this.readHistoryState(),
    }];
    this.index = 0;
  }

  private saveCurrentScroll(): ScrollPosition {
    const scroll = this.readScroll();
    if (this.index >= 0) {
      const entry = this.entries[this.index];
      if (entry) {
        this.entries[this.index] = {
          href: entry.href,
          scroll,
          state: entry.state,
        };
      }
    }
    return scroll;
  }

  createDefaultUpdate(): HistoryUpdate {
    this.ensureHistoryEntry();
    return {
      type: 'none',
      previousIndex: this.index,
      nextIndex: this.index,
      previousScroll: this.readScroll(),
      previousEntry: this.entries[this.index],
    };
  }

  createUpdate(href: string, replace: boolean, state: unknown): HistoryUpdate {
    this.ensureHistoryEntry();
    const previousScroll = this.saveCurrentScroll();
    const previousIndex = this.index;
    const nextEntry: HistoryEntry = {
      href,
      scroll: replace ? previousScroll : ZERO_SCROLL,
      state: state ?? null,
    };

    if (replace) {
      const previousEntry = this.entries[this.index];
      this.entries[this.index] = nextEntry;
      return {
        type: 'replace',
        previousIndex,
        nextIndex: this.index,
        previousEntry,
        previousScroll,
        nextEntry,
      };
    }

    this.entries = this.entries.slice(0, this.index + 1);
    this.entries.push(nextEntry);
    return {
      type: 'push',
      previousIndex,
      nextIndex: this.index + 1,
      previousScroll,
      previousEntry: this.entries[previousIndex],
      nextEntry,
    };
  }

  createPopStateUpdate(href: string): HistoryUpdate {
    this.ensureHistoryEntry();
    const previousScroll = this.saveCurrentScroll();
    const previousIndex = this.index;
    const resolvedIndex = this.findHistoryIndexByHref(href);
    const nextIndex = resolvedIndex >= 0 ? resolvedIndex : previousIndex;
    const nextEntry = this.entries[nextIndex]
      ? {
        ...this.entries[nextIndex]!,
        href,
        state: this.readHistoryState(),
      }
      : {
        href,
        scroll: ZERO_SCROLL,
        state: this.readHistoryState(),
      };

    return {
      type: 'popstate',
      previousIndex,
      nextIndex,
      previousScroll,
      previousEntry: this.entries[previousIndex],
      nextEntry,
    };
  }

  private findHistoryIndexByHref(href: string): number {
    if (this.entries.length === 0) {
      return -1;
    }

    const previous = this.entries[this.index - 1];
    if (previous?.href === href) {
      return this.index - 1;
    }

    const next = this.entries[this.index + 1];
    if (next?.href === href) {
      return this.index + 1;
    }

    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (let index = 0; index < this.entries.length; index++) {
      if (this.entries[index]?.href !== href || index === this.index) {
        continue;
      }

      const distance = Math.abs(index - this.index);
      if (distance < bestDistance) {
        bestIndex = index;
        bestDistance = distance;
      }
    }

    return bestIndex;
  }

  rollbackUpdate(update: HistoryUpdate): void {
    switch (update.type) {
      case 'push':
        this.entries = this.entries.slice(0, update.previousIndex + 1);
        this.index = update.previousIndex;
        return;
      case 'replace':
        if (update.previousEntry && update.previousIndex >= 0) {
          this.entries[update.previousIndex] = update.previousEntry;
        }
        this.index = update.previousIndex;
        return;
      case 'popstate':
      case 'none':
        this.index = update.previousIndex;
        return;
    }
  }

  commitUpdate(update: HistoryUpdate, href: string): void {
    this.index = update.nextIndex;
    this.entries[this.index] = update.nextEntry ?? {
      href,
      scroll: update.type === 'replace' ? update.previousScroll : ZERO_SCROLL,
      state: null,
    };
  }
}