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
      import('./angular-form.page').then((m) => m.AngularFormPageComponent),
  },
  {
    path: 'streamix',
    loadComponent: () =>
      import('./streamix-form.page').then((m) => m.StreamixFormPageComponent),
  },
];
