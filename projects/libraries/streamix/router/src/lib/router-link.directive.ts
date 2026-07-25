import { Directive, ElementRef, HostListener, inject, Input, OnChanges, Renderer2 } from '@angular/core';
import { NavigationTarget } from './navigation-types';
import { StreamixRouter } from './streamix-router';

@Directive({
  selector: 'a[routerLink]',
  standalone: true,
})
export class RouterLink implements OnChanges {
  private readonly router = inject(StreamixRouter);
  private readonly elementRef = inject(ElementRef<HTMLAnchorElement>);
  private readonly renderer = inject(Renderer2);

  @Input('routerLink')
  target: NavigationTarget | null | undefined;

  ngOnChanges(): void {
    this.updateHref();
  }

  @HostListener('click', ['$event'])
  onClick(event: MouseEvent): boolean {
    // Allow default browser behavior for modifier keys (e.g., ctrl/cmd-click for new tab)
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button > 0) {
      return true;
    }

    if (this.target) {
      // The router's navigate method will handle the discriminated union
      this.router.navigate(this.target);
      event.preventDefault(); // Prevent full page reload
    }

    return false;
  }

  private updateHref(): void {
    const href = this.router.href(this.target);
    if (href === null) {
      // If the link cannot be generated, remove the href to disable the link
      this.renderer.removeAttribute(this.elementRef.nativeElement, 'href');
    } else {
      this.renderer.setAttribute(this.elementRef.nativeElement, 'href', href);
    }
  }
}