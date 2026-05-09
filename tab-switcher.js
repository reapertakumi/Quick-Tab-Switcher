// This script is injected when Ctrl+Shift+Q is pressed
// It triggers the tab switcher UI in the content script

console.log('Tab switcher script injected, sending toggle message');
window.postMessage({
  type: 'TOGGLE_TAB_SWITCHER'
}, '*');
