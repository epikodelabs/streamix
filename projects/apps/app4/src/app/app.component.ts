import { AfterViewInit, Component, OnDestroy } from '@angular/core';
import { addListener, filter, map, merge, pipe, scope, tap } from '@epikodelabs/streamix';
import { on } from '@epikodelabs/streamix/dom';

interface AppModel {
    scrolled: boolean;
    heroTransform: string;
    activeSlide: number;
}

@Component({
    selector: 'app-root',
    standalone: true,
    imports: [],
    template: `
    <header class="site-header" [class.scrolled]="model.scrolled">
      <div class="header-inner">
        <a href="#" class="logo">Wanderlust</a>
        <nav class="main-nav">
          <a href="#destinations">Destinations</a>
          <a href="#journal">Journal</a>
          <a href="#tips">Tips</a>
          <a href="#newsletter" class="nav-cta">Subscribe</a>
        </nav>
      </div>
    </header>

    <section class="hero">
      <div class="hero-media">
        <img src="https://images.unsplash.com/photo-1506905925346-21bda4d32df4" alt="Mountain landscape" [style.transform]="model.heroTransform" />
        <div class="hero-overlay"></div>
      </div>
      <div class="hero-content">
        <p class="hero-eyebrow animate-text">The Travel Journal</p>
        <h1 class="hero-title animate-text">Wander Far, <br />Live Fully</h1>
        <p class="hero-lead animate-text">
          Stories from the road less traveled — remote peaks, hidden coastlines, and the people who make places unforgettable.
        </p>
        <a href="#destinations" class="hero-cta animate-text">Explore Destinations</a>
      </div>
      <div class="scroll-hint">
        <span class="scroll-line"></span>
      </div>
    </section>

    <section class="destinations" id="destinations">
      <div class="section-header reveal">
        <span class="section-label">Featured</span>
        <h2>Destinations</h2>
        <p>Hand-picked places that will take your breath away.</p>
      </div>

      <div class="destination-showcase reveal">
        <div class="showcase-stage">
          <div class="showcase-slide" [class.active]="model.activeSlide === 0">
            <img src="https://images.unsplash.com/photo-1433086966358-54859d0ed716" alt="Waterfall in green forest" />
            <div class="slide-caption">
              <span class="slide-tag">Pacific Northwest</span>
              <h3>Multnomah Falls</h3>
              <p>A two-tiered waterfall cascading through lush Columbia River Gorge rainforest.</p>
            </div>
          </div>
          <div class="showcase-slide" [class.active]="model.activeSlide === 1">
            <img src="https://images.unsplash.com/photo-1521747116042-5a810fda9664" alt="Golden Gate Bridge" />
            <div class="slide-caption">
              <span class="slide-tag">North America</span>
              <h3>San Francisco</h3>
              <p>The Golden Gate Bridge at golden hour — fog rolling in from the Pacific.</p>
            </div>
          </div>
          <div class="showcase-slide" [class.active]="model.activeSlide === 2">
            <img src="https://images.unsplash.com/photo-1514282401047-d79a71a590e8" alt="Maldives overwater bungalows" />
            <div class="slide-caption">
              <span class="slide-tag">Indian Ocean</span>
              <h3>Maldives</h3>
              <p>Overwater villas above crystalline lagoons — the ultimate escape into turquoise tranquility.</p>
            </div>
          </div>
        </div>
        <div class="showcase-dots">
          <button class="dot" [class.active]="model.activeSlide === 0" (click)="goTo(0)" aria-label="Slide 1"></button>
          <button class="dot" [class.active]="model.activeSlide === 1" (click)="goTo(1)" aria-label="Slide 2"></button>
          <button class="dot" [class.active]="model.activeSlide === 2" (click)="goTo(2)" aria-label="Slide 3"></button>
        </div>
      </div>
    </section>

    <section class="journal" id="journal">
      <div class="section-header reveal">
        <span class="section-label">Journal</span>
        <h2>Latest Stories</h2>
        <p>Field notes, photography, and reflections from recent journeys.</p>
      </div>

      <div class="posts-grid">
        <article class="post-card reveal">
          <div class="post-image">
            <img src="https://images.unsplash.com/photo-1500530855697-b586d89ba3ee" alt="Alpine peaks" />
          </div>
          <div class="post-body">
            <span class="post-date">March 2025</span>
            <h3>Above the Cloud Line</h3>
            <p>A solo trek through the Swiss Alps taught me that the best views demand the hardest climbs.</p>
            <a href="#" class="read-more">Read story →</a>
          </div>
        </article>

        <article class="post-card reveal">
          <div class="post-image">
            <img src="https://images.unsplash.com/photo-1507525428034-b723cf961d3e" alt="Tropical beach" />
          </div>
          <div class="post-body">
            <span class="post-date">February 2025</span>
            <h3>The Quiet Shores of Thailand</h3>
            <p>Far from the tourist trail, untouched beaches and warm turquoise shallows await.</p>
            <a href="#" class="read-more">Read story →</a>
          </div>
        </article>

        <article class="post-card reveal">
          <div class="post-image">
            <img src="https://images.unsplash.com/photo-1512453979798-5ea266f8880c" alt="Hot air balloons" />
          </div>
          <div class="post-body">
            <span class="post-date">January 2025</span>
            <h3>Dawn in Cappadocia</h3>
            <p>Hundreds of hot air balloons rising over fairy chimneys at sunrise — a surreal spectacle.</p>
            <a href="#" class="read-more">Read story →</a>
          </div>
        </article>
      </div>
    </section>

    <section class="tips" id="tips">
      <div class="tips-inner">
        <div class="section-header reveal">
          <span class="section-label">Essentials</span>
          <h2>Travel Tips</h2>
          <p>Wisdom gathered from years on the road.</p>
        </div>

        <ul class="tips-list">
          <li class="reveal">Pack only what you need — every extra kilogram is a burden on the trail.</li>
          <li class="reveal">Learn "hello" and "thank you" in the local language. It opens more doors than you imagine.</li>
          <li class="reveal">Travel insurance is not optional. Neither is a backup of your passport.</li>
          <li class="reveal">Wake up early. The best light, the quietest streets, the most authentic moments happen at dawn.</li>
          <li class="reveal">Eat where the locals eat. If the menu has photos, walk on.</li>
        </ul>
      </div>
    </section>

    <section class="newsletter" id="newsletter">
      <div class="newsletter-inner reveal">
        <div class="newsletter-content">
          <h2>Join the Journey</h2>
          <p>One email per month. No spam, no noise — just stories, photography, and travel inspiration.</p>
        </div>
        <form class="newsletter-form">
          <input type="email" placeholder="your@email.com" />
          <button type="submit">Subscribe</button>
        </form>
      </div>
    </section>

    <footer class="site-footer">
      <div class="footer-inner">
        <div class="footer-brand">
          <span class="logo">Wanderlust</span>
          <p>Travel deeper. Stay curious.</p>
        </div>
        <div class="footer-links">
          <a href="#">Instagram</a>
          <a href="#">Twitter</a>
          <a href="#">YouTube</a>
        </div>
      </div>
      <p class="footer-copy">&copy; 2025 Wanderlust Journal. All rights reserved.</p>
    </footer>
  `,
})
export class AppComponent implements AfterViewInit, OnDestroy {
    // Reactive page state: the compiled template updates the header shadow,
    // hero parallax, and carousel directly from these writes.
    readonly model = scope<AppModel>({
        scrolled: false,
        heroTransform: '',
        activeSlide: 0,
    });

    private autoAdvance?: ReturnType<typeof setInterval>;

    ngAfterViewInit(): void {
        this.initHeaderScroll();
        this.initHeroParallax();
        this.initTextReveal();
        this.initScrollReveal();
        this.startAutoAdvance();
        this.initPostCardTilt();
        this.initNewsletterFocus();
        this.initSmoothAnchors();
    }

    ngOnDestroy(): void {
        this.stopAutoAdvance();
        this.model.dispose();
    }

    goTo(index: number): void {
        this.stopAutoAdvance();
        this.model.activeSlide = index;
        this.startAutoAdvance();
    }

    private initHeaderScroll(): void {
        pipe(
            addListener(window, 'scroll'),
            map(() => window.scrollY > 20),
            filter((scrolled: boolean) => scrolled !== this.model.scrolled),
            tap(scrolled => { this.model.scrolled = scrolled; }),
        ).subscribe(() => { });
    }

    private initHeroParallax(): void {
        pipe(
            on('animationFrame'),
            tap(() => {
                const scrollY = window.scrollY;
                const scale = 1.08 + scrollY * 0.00015;
                const translateY = scrollY * 0.3;
                this.model.heroTransform = `scale(${scale}) translateY(${translateY}px)`;
            }),
        ).subscribe(() => { });
    }

    private initTextReveal(): void {
        document.querySelectorAll('.animate-text').forEach((el) => {
            const text = el.textContent || '';
            el.innerHTML = '';
            text.split('').forEach((char) => {
                const span = document.createElement('span');
                span.textContent = char === ' ' ? '\u00A0' : char;
                span.style.transitionDelay = `${Math.random() * 0.4}s`;
                el.appendChild(span);
            });
            pipe(on('intersection', el, { threshold: 0.3 }), filter(visible => visible), tap(() => el.classList.add('visible')))
                .subscribe(() => { });
        });
    }

    private initScrollReveal(): void {
        document.querySelectorAll('.reveal').forEach((el, index) => {
            (el as HTMLElement).style.transitionDelay = `${index * 0.06}s`;
            pipe(on('intersection', el, { threshold: 0.15 }), filter(visible => visible), tap(() => el.classList.add('visible')))
                .subscribe(() => { });
        });
    }

    private startAutoAdvance(): void {
        this.autoAdvance = setInterval(() => {
            this.model.activeSlide = (this.model.activeSlide + 1) % 3;
        }, 5000);
    }

    private stopAutoAdvance(): void {
        clearInterval(this.autoAdvance);
    }

    private initPostCardTilt(): void {
        document.querySelectorAll('.post-card').forEach((card) => {
            const el = card as HTMLElement;
            pipe(addListener(el, 'mousemove'), map((e: Event) => {
                const ev = e as MouseEvent;
                const rect = el.getBoundingClientRect();
                const x = (ev.clientX - rect.left) / rect.width - 0.5;
                const y = (ev.clientY - rect.top) / rect.height - 0.5;
                return { x, y };
            }), tap(({ x, y }) => {
                el.style.transform = `translateY(-6px) perspective(800px) rotateX(${-y * 4}deg) rotateY(${x * 4}deg)`;
            }))
                .subscribe(() => { });
            pipe(addListener(el, 'mouseleave'), tap(() => {
                el.style.transform = '';
            }))
                .subscribe(() => { });
        });
    }

    private initNewsletterFocus(): void {
        const newsletterInput = document.querySelector('.newsletter-form input') as HTMLInputElement | null;
        const newsletterBtn = document.querySelector('.newsletter-form button') as HTMLButtonElement | null;
        if (newsletterInput) {
            merge(pipe(addListener(newsletterInput, 'focus'), tap(() => {
                newsletterInput.style.borderColor = 'var(--accent)';
            })), pipe(addListener(newsletterInput, 'blur'), tap(() => {
                newsletterInput.style.borderColor = '';
            }))).subscribe(() => { });
        }
        if (newsletterBtn) {
            pipe(addListener(newsletterBtn, 'mouseenter'), tap(() => newsletterBtn.style.transform = 'translateY(-2px)'))
                .subscribe(() => { });
            pipe(addListener(newsletterBtn, 'mouseleave'), tap(() => newsletterBtn.style.transform = ''))
                .subscribe(() => { });
        }
    }

    private initSmoothAnchors(): void {
        document.querySelectorAll('a[href^="#"]').forEach((link) => {
            pipe(addListener(link, 'click'), tap((e) => {
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
    }
}
