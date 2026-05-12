// Global env is 'node' to avoid breaking matchMedia / import.meta.url assumptions
// in existing tests. For DOM-dependent tests (React component / hook tests),
// add: // @vitest-environment jsdom  at the top of that test file.
export {}
