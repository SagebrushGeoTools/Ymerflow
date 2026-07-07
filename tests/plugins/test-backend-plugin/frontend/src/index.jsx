import TestBackendWidget from './TestBackendWidget'

// Register widget via the host's window global (set by hooks.js before plugin loading)
if (typeof window !== 'undefined' && window.__nagelfluh_registerHook) {
  window.__nagelfluh_registerHook('widgets', () => [
    { name: 'TestBackendWidget', component: TestBackendWidget },
  ])
} else {
  console.error('[test-backend-plugin] window.__nagelfluh_registerHook not available')
}
