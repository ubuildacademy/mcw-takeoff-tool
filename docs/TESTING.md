# Testing in Meridian Takeoff

## What are tests?

**Tests** are small programs that run your code in a controlled way and check that it behaves as expected. Think of them as “automated checks” that run every time you (or your CI) run the test command.

- **Unit tests** – Test one piece of logic in isolation (e.g. a hook, a pure function). They run in Node, are fast, and don’t open a browser.
- **Integration tests** – Test several pieces together (e.g. a component that uses a hook and a store).

For the new hooks we extracted, **unit tests** are the right fit: we call the hook with fake (mocked) data and assert that it returns the right state and callbacks.

## Why do we need them?

1. **Catch regressions** – When you refactor or add features, tests fail if you break existing behavior.
2. **Document behavior** – Tests show how the hook/function is supposed to be used and what it returns.
3. **Confidence** – You can change code without manually re-checking every flow.
4. **Faster feedback** – Running 20 unit tests is much faster than clicking through the app 20 times.

You don’t need to test every line; focus on important behavior (e.g. “when I pass X, the hook returns Y” or “when I call this callback, state updates like this”).

## Test runner: Vitest

This project uses **Vite**. The recommended test runner is **Vitest**:

- **Same config as Vite** – Uses your `tsconfig` and env; no extra build step.
- **Fast** – Runs in Node with ESM; watch mode is very quick.
- **Familiar API** – Same style as Jest (`describe`, `it`, `expect`), so docs and examples are easy to find.
- **Great for React** – Works seamlessly with **@testing-library/react** for rendering components and testing hooks.

We use **@testing-library/react**’s `renderHook` to test hooks: it renders the hook in a tiny test component and gives you the current result and a way to rerender with new props.

## Commands

- `npm run test` – Run all unit tests once.
- `npm run test:watch` – Run tests in watch mode (rerun on file changes).
- `npm run test:coverage` – Run tests and print coverage (optional).

## Where tests live

- **Co-located:** Next to the code (e.g. `useTakeoffExport.ts` beside `useTakeoffExport.test.ts`, or `src/utils/*.test.ts`).
- **Feature modules:** e.g. `src/services/batchHyperlink/*.test.ts` for hyperlink/sheet-index logic.
- **Or** a top-level `src/__tests__/` folder if you prefer a single test root.

Run `npm run test` after changes to core geometry, export, or batch-hyperlink helpers; add tests when fixing subtle parsing or merge behavior.
