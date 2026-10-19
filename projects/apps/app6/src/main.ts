import { bootstrapApplication } from '@angular/platform-browser';

import { enableStreamixIntrospection, mountStreamixInspector } from '@epikodelabs/streamix';
import { AppComponent } from './app/app.component';

// Mirrors the builder's introspection injection: enable before the app creates
// its atoms, mount after bootstrap. Both are no-ops unless the development
// build defines import.meta.env.DEV, so production ships no inspector and no
// window.__streamix.
enableStreamixIntrospection();

bootstrapApplication(AppComponent).catch(error => console.error(error));

mountStreamixInspector();
