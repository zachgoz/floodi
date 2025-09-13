// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom/extend-expect';

// Mock matchmedia
window.matchMedia = window.matchMedia || function() {
  return {
      matches: false,
      addListener: function() {},
      removeListener: function() {}
  };
};

// Polyfill ResizeObserver for JSDOM (used by ChartViewer)
class ResizeObserverStub {
  callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}
// @ts-ignore - attach to global if missing
if (!(globalThis as any).ResizeObserver) {
  // @ts-ignore
  (globalThis as any).ResizeObserver = ResizeObserverStub;
}

// Polyfill IntersectionObserver used by some Ionic components (e.g., IonDatetime)
class IntersectionObserverStub {
  constructor(_cb: IntersectionObserverCallback, _opts?: IntersectionObserverInit) {}
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] { return []; }
}
// @ts-ignore
if (!(globalThis as any).IntersectionObserver) {
  // @ts-ignore
  (globalThis as any).IntersectionObserver = IntersectionObserverStub;
}

// Reduce noisy act() warnings from React during async context updates in tests
const originalConsoleError = console.error;
console.error = (...args: any[]) => {
  const msg = args?.[0];
  if (typeof msg === 'string' && msg.includes('not wrapped in act(')) {
    return; // suppress
  }
  originalConsoleError(...args as Parameters<typeof originalConsoleError>);
};
