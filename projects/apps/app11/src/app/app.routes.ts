import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'angular',
  },
  {
    path: 'angular',
    loadComponent: () =>
      import('./pages/angular-form/angular-form.page').then((m) => m.AngularFormPageComponent),
  },
  {
    path: 'streamix',
    loadComponent: () =>
      import('./pages/streamix-form/streamix-form.page').then((m) => m.StreamixFormPageComponent),
  },
];
