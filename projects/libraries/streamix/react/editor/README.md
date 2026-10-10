# Streamix React editor support

This TypeScript server plugin gives supported Streamix React TSX syntax
value-level type checking in editors that use TypeScript's language service,
including VS Code. It is not a separate VS Code extension.

## Install

    npm install @epikodelabs/streamix
    npm install -D typescript

## Configure

Add this to the React project's tsconfig.json:

    {
      "compilerOptions": {
        "plugins": [
          { "name": "@epikodelabs/streamix/react/editor/tsserver" }
        ]
      }
    }

Restart the TypeScript server after editing the configuration. In VS Code, run
TypeScript: Restart TS Server from the command palette.

## Semantics

For supported JSX expressions, the editor sees atom(1) as its current number
value. Direct and compound writes are checked as atom writes. Diagnostics and
navigation spans map back to authored TSX.

The Streamix compiler and Vite or Angular builder remain the authority for
emitted JavaScript. Dynamic access, arbitrary aliases, and third-party prop
semantics should retain explicit runtime APIs where intent cannot be proven.
