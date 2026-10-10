# Streamix Angular editor support

This TypeScript server plugin delegates to Angular's official language service
after virtualizing supported Streamix atom reads in inline component templates.
It is not a separate VS Code extension.

## Install

    npm install @epikodelabs/streamix
    npm install -D @angular/language-service typescript

Use an Angular Language Service version compatible with the application.

## Configure

Add only the Streamix plugin to the Angular application's tsconfig.app.json:

    {
      "compilerOptions": {
        "plugins": [
          { "name": "@epikodelabs/streamix/angular/editor/tsserver" }
        ]
      }
    }

Do not also add @angular/language-service to the plugins list: Streamix
delegates to it internally after installing the virtual source host. Restart
the TypeScript server after changing the setting. In VS Code, run TypeScript:
Restart TS Server and keep the Angular Language Service extension enabled.

## Semantics and current boundary

For inline component templates, a field initialized with atom(...) is
type-checked as its current value in supported Angular template expressions.
Direct and compound event writes are checked as atom next writes. Diagnostics
map back to authored component locations.

This first version supports inline component templates only. External
templateUrl files need explicit .value reads until an Angular template-host
virtual-file layer is added. The build compiler remains authoritative for
generated application code and its wider transform surface.
