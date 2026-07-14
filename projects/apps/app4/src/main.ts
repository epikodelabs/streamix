import { filter, fromEvent, map, merge, pipe, tap } from '@epikodelabs/streamix';
import { on } from '@epikodelabs/streamix/dom';
/* ─── 1. Header scroll shadow ─── */
const header = document.querySelector('.site-header') as HTMLElement;
if (header) {
    pipe(fromEvent(window, 'scroll'), map(() => window.scrollY > 20), filter((scrolled) => scrolled !== header.classList.contains('scrolled')), tap((scrolled) => header.classList.toggle('scrolled', scrolled)))
        .subscribe(() => { });
}
/* ─── 2. Hero parallax + text reveal ─── */
const heroMedia = document.querySelector('.hero-media img') as HTMLImageElement;
// Parallax on scroll
if (heroMedia) {
    pipe(on('animationFrame'), map(() => {
        const scrollY = window.scrollY;
        const scale = 1.08 + scrollY * 0.00015;
        const translateY = scrollY * 0.3;
        heroMedia.style.transform = `scale(${scale}) translateY(${translateY}px)`;
    }))
        .subscribe(() => { });
}
// Character-by-character text reveal
const animateTextElements = document.querySelectorAll('.animate-text');
animateTextElements.forEach((el) => {
    const text = el.textContent || '';
    el.innerHTML = '';
    text.split('').forEach((char) => {
        const span = document.createElement('span');
        span.textContent = char === ' ' ? '\u00A0' : char;
        span.style.transitionDelay = `${Math.random() * 0.4}s`;
        el.appendChild(span);
    });
    pipe(on('intersection', el, { threshold: 0.3 }), filter((visible) => visible), tap(() => el.classList.add('visible')))
        .subscribe(() => { });
});
/* ─── 3. Scroll reveal ─── */
const revealElements = document.querySelectorAll('.reveal');
revealElements.forEach((el, index) => {
    (el as HTMLElement).style.transitionDelay = `${index * 0.06}s`;
    pipe(on('intersection', el, { threshold: 0.15 }), filter((visible) => visible), tap(() => el.classList.add('visible')))
        .subscribe(() => { });
});
/* ─── 4. Destination carousel ─── */
const slides = document.querySelectorAll('.showcase-slide') as NodeListOf<HTMLElement>;
const dots = document.querySelectorAll('.showcase-dots .dot') as NodeListOf<HTMLButtonElement>;
let currentSlide = 0;
let autoAdvance: ReturnType<typeof setInterval>;
const goToSlide = (index: number) => {
    slides[currentSlide].classList.remove('active');
    dots[currentSlide].classList.remove('active');
    currentSlide = index;
    slides[currentSlide].classList.add('active');
    dots[currentSlide].classList.add('active');
};
const nextSlide = () => goToSlide((currentSlide + 1) % slides.length);
const startAutoAdvance = () => {
    autoAdvance = setInterval(nextSlide, 5000);
};
const stopAutoAdvance = () => clearInterval(autoAdvance);
dots.forEach((dot, i) => {
    pipe(fromEvent(dot, 'click'), tap(() => {
        stopAutoAdvance();
        goToSlide(i);
        startAutoAdvance();
    }))
        .subscribe(() => { });
});
startAutoAdvance();
/* ─── 5. Post card hover tilt (subtle) ─── */
const postCards = document.querySelectorAll('.post-card');
postCards.forEach((card) => {
    const el = card as HTMLElement;
    pipe(fromEvent(el, 'mousemove'), map((e: Event) => {
        const ev = e as MouseEvent;
        const rect = el.getBoundingClientRect();
        const x = (ev.clientX - rect.left) / rect.width - 0.5;
        const y = (ev.clientY - rect.top) / rect.height - 0.5;
        return { x, y };
    }), tap(({ x, y }) => {
        el.style.transform = `translateY(-6px) perspective(800px) rotateX(${-y * 4}deg) rotateY(${x * 4}deg)`;
    }))
        .subscribe(() => { });
    pipe(fromEvent(el, 'mouseleave'), tap(() => {
        el.style.transform = '';
    }))
        .subscribe(() => { });
});
/* ─── 6. Newsletter focus effects ─── */
const newsletterInput = document.querySelector('.newsletter-form input') as HTMLInputElement;
const newsletterBtn = document.querySelector('.newsletter-form button') as HTMLButtonElement;
if (newsletterInput) {
    merge(pipe(fromEvent(newsletterInput, 'focus'), tap(() => {
        newsletterInput.style.borderColor = 'var(--accent)';
    })), pipe(fromEvent(newsletterInput, 'blur'), tap(() => {
        newsletterInput.style.borderColor = '';
    }))).subscribe(() => { });
}
if (newsletterBtn) {
    pipe(fromEvent(newsletterBtn, 'mouseenter'), tap(() => newsletterBtn.style.transform = 'translateY(-2px)'))
        .subscribe(() => { });
    pipe(fromEvent(newsletterBtn, 'mouseleave'), tap(() => newsletterBtn.style.transform = ''))
        .subscribe(() => { });
}
/* ─── 7. Smooth anchor scroll offset for fixed header ─── */
document.querySelectorAll('a[href^="#"]').forEach((link) => {
    pipe(fromEvent(link, 'click'), tap((e) => {
        e.preventDefault();
        const href = (link as HTMLAnchorElement).getAttribute('href');
        const target = document.querySelector(href!);
        if (target) {
            const y = target.getBoundingClientRect().top + window.scrollY - 80;
            window.scrollTo({ top: y, behavior: 'smooth' });
        }
    }))
        .subscribe(() => { });
});
