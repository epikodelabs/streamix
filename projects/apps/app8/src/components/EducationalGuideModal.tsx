import React, { useEffect, useRef } from 'react';

import { ArrowRight, X } from 'lucide-react';

interface EducationalGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Compact, readable documentation with a fixed header and scrolling body. */
export const EducationalGuideModal: React.FC<EducationalGuideModalProps> = ({ isOpen, onClose }) => {
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
      if (event.key === 'Tab') {
        const dialog = closeRef.current?.closest('[role="dialog"]');
        if (!dialog) return;
        const focusables = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), [tabindex]:not([tabindex="-1"])'));
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fifo-doc-overlay" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="fifo-doc-title" aria-describedby="fifo-doc-subtitle" className="fifo-doc-dialog">
        <header className="fifo-doc-header">
          <div>
            <span className="fifo-doc-eyebrow">STREAMIX / REFERENCE</span>
            <h2 id="fifo-doc-title">How the FIFO queue works</h2>
            <p id="fifo-doc-subtitle">Push sources, buffering and consumption</p>
          </div>
          <button ref={closeRef} className="fifo-doc-icon-button" onClick={onClose} aria-label="Close documentation" title="Close documentation">
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="fifo-doc-body">
          <section className="fifo-doc-section" aria-labelledby="fifo-doc-overview">
            <h3 id="fifo-doc-overview"><span className="fifo-doc-section-num">01</span> Overview</h3>
            <p><code>fromPush&lt;T&gt;(connect, options)</code> adapts an event-driven source into a reactive atom backed by an asynchronous delivery pipeline.</p>
            <div className="fifo-doc-flow" aria-label="Producer to FIFO buffer to consumer">
              <span>Producer</span><ArrowRight size={16} aria-hidden="true" /><span>FIFO buffer</span><ArrowRight size={16} aria-hidden="true" /><span>Consumer</span>
            </div>
            <p>Values enter the buffer in arrival order. The oldest buffered value is delivered first. When the buffer is full, the configured overflow policy decides what happens next.</p>
          </section>

          <section className="fifo-doc-section" aria-labelledby="fifo-doc-backpressure">
            <h3 id="fifo-doc-backpressure"><span className="fifo-doc-section-num">02</span> Backpressure</h3>
            <p>In <code>block</code> mode, <code>next(value)</code> returns a promise. When the buffer has room, the value is admitted immediately and the promise resolves. When the buffer is full, the push waits in the source's blocked queue; as soon as a consumer frees a slot, the oldest waiting value is admitted and its promise resolves. Admission — not delivery — ends backpressure.</p>
            <div className="fifo-doc-note"><strong>Two producer behaviors</strong><p>The automatic source awaits every push, so it pauses while the buffer is full and holds at most one blocked value. “Push one” and “Burst” ignore the returned promises on purpose; a timer or event source cannot be paused this way, so its blocked backlog keeps growing.</p></div>
            <p>The visualizer displays the first three waiting values. A <code>+N</code> label counts the rest; none are removed just because they are hidden.</p>
          </section>

          <section className="fifo-doc-section" aria-labelledby="fifo-doc-modes">
            <h3 id="fifo-doc-modes"><span className="fifo-doc-section-num">03</span> Modes &amp; overflow policies</h3>
            <div className="fifo-doc-definition-grid">
              <div><h4>Discrete</h4><p>Maintains individual values in arrival order, subject to the overflow policy.</p></div>
              <div><h4>Analog</h4><p>Prioritizes the latest snapshot; superseded pending values may be coalesced.</p></div>
            </div>
            <dl className="fifo-doc-definitions">
              <div><dt><code>block</code></dt><dd>Wait for available capacity; preserve arrival order.</dd></div>
              <div><dt><code>drop-oldest</code></dt><dd>Replace the oldest queued value when full.</dd></div>
              <div><dt><code>drop-newest</code></dt><dd>Discard the incoming value when full.</dd></div>
              <div><dt><code>error</code></dt><dd>Terminate the session on buffer overflow.</dd></div>
            </dl>
          </section>

          <section className="fifo-doc-section" aria-labelledby="fifo-doc-completion">
            <h3 id="fifo-doc-completion"><span className="fifo-doc-section-num">04</span> Completion &amp; errors</h3>
            <p><code>sink.complete()</code> stops accepting new values. Previously accepted buffered and blocked values can still drain; the consumer sees completion only after delivery finishes.</p>
            <p><code>sink.error(reason)</code> terminates the session immediately in the visualizer and discards outstanding queued work.</p>
          </section>
        </div>

        <footer className="fifo-doc-footer">
          <span>Esc to close · Scroll to read</span>
          <button className="fifo-doc-done" onClick={onClose}>Done</button>
        </footer>
      </section>
    </div>
  );
};
