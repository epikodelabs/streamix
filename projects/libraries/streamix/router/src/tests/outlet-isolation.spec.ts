import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
    BrowserDynamicTestingModule,
    platformBrowserDynamicTesting,
} from '@angular/platform-browser-dynamic/testing';

import { StreamixOutlet } from '../lib/outlet';

@Component({
  standalone: true,
  imports: [StreamixOutlet],
  template: '<streamix-outlet />',
})
class OutletHost {}

describe('StreamixOutlet isolation', () => {
  beforeEach(() => {
    TestBed.initTestEnvironment(
      BrowserDynamicTestingModule,
      platformBrowserDynamicTesting(),
    );
  });

  it('should compile as a standalone directive', async () => {
    expect(StreamixOutlet).toBeTruthy();
    expect((StreamixOutlet as any).ɵdir).toBeTruthy();

    await TestBed.configureTestingModule({
      imports: [OutletHost],
    }).compileComponents();

    expect().nothing();
  });
});