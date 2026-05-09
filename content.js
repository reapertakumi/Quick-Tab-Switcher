let tabSwitcherVisible = false;
let tabSwitcherContainer = null;
let currentTabs = [];
let currentTabId = null;
let selectedIndex = 0;
let currentTheme = 'light'; // 'light', 'dark', or 'system'

// Track modifier key states
let ctrlPressed = false;
let shiftPressed = false;
let metaPressed = false;

// Safety timeout to auto-close switcher if stuck
let safetyTimeout = null;
const SAFETY_TIMEOUT_MS = 15000; // 15 seconds max

// Theme management
function detectSystemTheme() {
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

function getEffectiveTheme() {
  return currentTheme === 'system' ? detectSystemTheme() : currentTheme;
}

function applyTheme() {
  const effectiveTheme = getEffectiveTheme();
  const overlay = document.getElementById('tab-switcher-overlay');
  
  if (overlay) {
    if (effectiveTheme === 'dark') {
      overlay.classList.add('dark-mode');
    } else {
      overlay.classList.remove('dark-mode');
    }
  }
}

function loadThemeSettings() {
  chrome.storage.sync.get(['theme'], function(result) {
    currentTheme = result.theme || 'system';
    applyTheme();
  });
}

// Listen for system theme changes
if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (currentTheme === 'system') {
      applyTheme();
    }
  });
}

// Load theme settings on startup
loadThemeSettings();

// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    try {
      if (request.action === "ping") {
        sendResponse({ success: true });
      } else if (request.action === "themeChanged") {
        currentTheme = request.theme;
        applyTheme();
        sendResponse({ success: true });
      } else if (request.action === "toggleSwitcher") {
        currentTabs = request.tabs || [];
        currentTabId = request.currentTabId;
        const direction = request.direction || "forward";

        if (tabSwitcherVisible) {
          chrome.storage.sync.get(['maxTabs'], function(result) {
            let maxVisibleTabs = result.maxTabs || 5;
            if (maxVisibleTabs === 'auto') {
              maxVisibleTabs = calculateAutoTabCount();
            }
            maxVisibleTabs = Math.min(currentTabs.length, maxVisibleTabs);
            if (direction === "forward") {
              selectedIndex = (selectedIndex + 1) % maxVisibleTabs;
            } else {
              selectedIndex = (selectedIndex - 1 + maxVisibleTabs) % maxVisibleTabs;
            }
            updateSelection(selectedIndex);
          });
        } else {
          chrome.storage.sync.get(['maxTabs'], function(result) {
            let maxVisibleTabs = result.maxTabs || 5;
            if (maxVisibleTabs === 'auto') {
              maxVisibleTabs = calculateAutoTabCount();
            }
            maxVisibleTabs = Math.min(currentTabs.length, maxVisibleTabs);
            if (direction === "forward") {
              selectedIndex = maxVisibleTabs > 1 ? 1 : 0;
            } else {
              selectedIndex = maxVisibleTabs > 1 ? maxVisibleTabs - 1 : 0;
            }
            showTabSwitcher();
          });
        }
        sendResponse({ success: true });
      }
    } catch (error) {
      console.error("Error in message listener:", error);
      sendResponse({ success: false, error: error.message });
    }
  })();
  return true;
});

// Listen for messages from injected script
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  
  console.log('Content script received message:', event.data);
  
  if (event.data.type === 'TOGGLE_TAB_SWITCHER') {
    console.log('Toggling tab switcher');
    toggleTabSwitcher();
  } else if (event.data.type === 'SWITCH_TO_TAB') {
    console.log('Switching to tab:', event.data.tabId);
    chrome.runtime.sendMessage({
      action: 'switchToTab',
      tabId: event.data.tabId
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Error switching tab:', chrome.runtime.lastError);
      }
    });
  } else if (event.data.type === 'HIDE_TAB_SWITCHER') {
    hideTabSwitcher();
  }
});

function toggleTabSwitcher() {
  if (tabSwitcherVisible) {
    hideTabSwitcher();
  } else {
    showTabSwitcher();
  }
}

function showTabSwitcher() {
  if (tabSwitcherVisible) return;
  tabSwitcherVisible = true;

  // Set safety timeout to auto-close if stuck
  if (safetyTimeout) clearTimeout(safetyTimeout);
  safetyTimeout = setTimeout(() => {
    if (tabSwitcherVisible) {
      console.warn("Tab switcher safety timeout triggered - auto-closing");
      hideTabSwitcher();
    }
  }, SAFETY_TIMEOUT_MS);
  
  // Notify background script that switcher is shown
  chrome.runtime.sendMessage({ action: "switcherShown" });
  
  // Create overlay container
  tabSwitcherContainer = document.createElement('div');
  tabSwitcherContainer.id = 'tab-switcher-overlay';
  tabSwitcherContainer.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.5);
    z-index: 999999;
    display: flex;
    justify-content: center;
    align-items: center;
  `;
  
  // Create tab switcher container
  const switcherContainer = document.createElement('div');
  switcherContainer.id = 'tab-switcher-container';
  
  // Get max tabs from storage to determine layout
  chrome.storage.sync.get(['maxTabs'], function(result) {
    const maxTabs = result.maxTabs || 5;
    if (maxTabs <= 5) {
      switcherContainer.classList.add('single-row');
    } else {
      switcherContainer.classList.add('two-row');
    }
  });
  
  tabSwitcherContainer.appendChild(switcherContainer);
  document.body.appendChild(tabSwitcherContainer);
  
  // Apply theme to the newly created overlay
  applyTheme();
  
  // Create UI with current tabs
  createTabElements(currentTabs, switcherContainer);
  
  // Add keyboard event listeners
  document.addEventListener('keydown', handleKeyDown);
  
  // Click to close
  tabSwitcherContainer.addEventListener('click', (e) => {
    if (e.target === tabSwitcherContainer) {
      hideTabSwitcher();
    }
  });
}

function createTabElements(tabs, container) {
  container.innerHTML = '';
  
  // Get max tabs from storage, default to 5
  chrome.storage.sync.get(['maxTabs'], function(result) {
    let maxTabs = result.maxTabs || 5;
    
    // Calculate auto tab count if needed
    if (maxTabs === 'auto') {
      maxTabs = calculateAutoTabCount();
    }
    
    const limitedTabs = tabs.slice(0, maxTabs);
    
    // Apply appropriate CSS class based on maxTabs setting
    container.classList.remove('single-row', 'two-row', 'three-row', 'four-row');
    
    if (maxTabs === 'auto') {
      // Use sophisticated rescaling for auto mode
      const screenWidth = window.innerWidth;
      const screenHeight = window.innerHeight;
      const pixelRatio = window.devicePixelRatio || 1;
      const aspectRatio = screenWidth / screenHeight;
      const screenCategory = detectScreenCategory(screenWidth, screenHeight);
      const baseDimensions = getBaseTabDimensions(screenCategory, pixelRatio);
      const layoutConstraints = getLayoutConstraints(screenCategory, aspectRatio);
      
      const tabWidth = baseDimensions.width;
      const tabHeight = baseDimensions.height;
      const gap = baseDimensions.gap;
      const horizontalPadding = layoutConstraints.horizontalPadding;
      const verticalPadding = layoutConstraints.verticalPadding;
      const maxTabsPerRow = layoutConstraints.maxTabsPerRow;
      
      const availableWidth = screenWidth - horizontalPadding;
      const availableHeight = screenHeight - verticalPadding;
      
      const tabsPerRow = Math.min(Math.floor((availableWidth + gap) / (tabWidth + gap)), maxTabsPerRow);
      const possibleRows = Math.min(Math.floor((availableHeight + gap) / (tabHeight + gap)), layoutConstraints.maxRows);
      
      // Apply appropriate CSS class based on row count
      if (possibleRows <= 1) {
        container.classList.add('single-row');
      } else if (possibleRows === 2) {
        container.classList.add('two-row');
      } else if (possibleRows === 3) {
        container.classList.add('three-row');
      } else {
        container.classList.add('four-row');
      }
    } else {
      // Use fixed layout for manual tab count
      const fixedMaxTabs = parseInt(maxTabs, 10);
      if (fixedMaxTabs <= 5) {
        container.classList.add('single-row');
      } else {
        container.classList.add('two-row');
      }
    }
    
    // Adjust selected index if it's out of bounds
    if (selectedIndex >= limitedTabs.length) {
      selectedIndex = limitedTabs.length - 1;
    }
    
    // Create all tab elements first
    const createPromises = limitedTabs.map((tab, index) => {
      return createTabElement(tab, index, container);
    });
    
    // Wait for all elements to be created, then set selection
    Promise.all(createPromises).then(() => {
      // Additional delay to ensure all async operations in createTabElement are complete
      setTimeout(() => {
        updateSelection(selectedIndex);
      }, 50);
    });
  });
}

function createTabElement(tab, index, container) {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['previewEnabled', 'highlightColor'], function(settings) {
      const previewEnabled = settings.previewEnabled !== false; // Default to true
      const highlightColor = settings.highlightColor || '#3b82f6'; // Default to blue
      
      const tabElement = document.createElement('div');
      tabElement.className = 'tab-item';
      if (tab.id === currentTabId) {
        tabElement.classList.add('current');
      }
      tabElement.dataset.tabId = tab.id;
      tabElement.dataset.index = index;
      
      tabElement.style.cssText = `
        width: 160px;
        height: 140px;
        background: white;
        border-radius: 8px;
        padding: 10px;
        cursor: pointer;
        border: 2px solid transparent;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      `;
      
      // Create favicon and title container
      const header = document.createElement('div');
      header.style.cssText = `
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 4px;
        padding-bottom: 4px;
        border-bottom: 1px solid #eee;
      `;
      
      const favicon = document.createElement('img');
      favicon.style.cssText = `
        width: 16px;
        height: 16px;
        min-width: 16px;
        min-height: 16px;
        border-radius: 2px;
        object-fit: cover;
      `;
      
      // Enhanced favicon handling with multiple fallbacks
      function setFaviconWithFallbacks() {
        // Try provided favicon URL first
        if (tab.favIconUrl && isValidFaviconUrl(tab.favIconUrl)) {
          favicon.src = tab.favIconUrl;
        } else {
          // Try to construct favicon URL from tab's domain
          const domainFavicon = getDomainFaviconUrl(tab.url);
          if (domainFavicon) {
            favicon.src = domainFavicon;
          } else {
            // Use a generic fallback
            favicon.src = getGenericFavicon(tab.url);
          }
        }
      }
      
      // Check if favicon URL is valid
      function isValidFaviconUrl(url) {
        if (!url) return false;
        try {
          const parsed = new URL(url);
          return parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'data:';
        } catch (e) {
          return false;
        }
      }
      
      // Get favicon URL from domain
      function getDomainFaviconUrl(tabUrl) {
        try {
          const url = new URL(tabUrl);
          if (isRestrictedUrl(url.protocol + '://' + url.host)) {
            return null; // Skip internal pages
          }
          return `${url.protocol}//${url.hostname}/favicon.ico`;
        } catch (e) {
          return null;
        }
      }
      
      // Get generic fallback favicon based on URL type
      function getGenericFavicon(tabUrl) {
        try {
          const url = new URL(tabUrl);
          const hostname = url.hostname.toLowerCase();
          
          // Special fallbacks for common sites
          if (hostname.includes('google')) {
            return 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="%234285f4"/><text x="12" y="16" text-anchor="middle" fill="white" font-family="Arial" font-size="12" font-weight="bold">G</text></svg>';
          } else if (hostname.includes('github')) {
            return 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="%23333"/><text x="12" y="16" text-anchor="middle" fill="white" font-family="Arial" font-size="12" font-weight="bold">G</text></svg>';
          } else if (hostname.includes('youtube')) {
            return 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="%23ff0000"/><path d="M10 8l6 4-6 4z" fill="white"/></svg>';
          } else if (hostname.includes('twitter') || hostname.includes('x.com')) {
            return 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="%231da1f2"/><path d="M8 12l2-2 4 4 2-2-4-4z" fill="white"/></svg>';
          } else if (hostname.includes('facebook')) {
            return 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="%231877f2"/><text x="12" y="16" text-anchor="middle" fill="white" font-family="Arial" font-size="12" font-weight="bold">f</text></svg>';
          } else if (hostname.includes('linkedin')) {
            return 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="%230077b5"/><text x="12" y="16" text-anchor="middle" fill="white" font-family="Arial" font-size="10" font-weight="bold">in</text></svg>';
          } else if (url.protocol === 'file:') {
            return 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="4" y="6" width="16" height="12" fill="%23666" rx="2"/><path d="M6 8h12v8H6z" fill="white"/><path d="M8 10h8v1H8z" fill="%23666"/></svg>';
          } else if (url.hostname === 'localhost' || url.hostname.includes('127.0.0.1')) {
            return 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="%2328a745"/><text x="12" y="16" text-anchor="middle" fill="white" font-family="monospace" font-size="10" font-weight="bold">DEV</text></svg>';
          } else {
            // Generic fallback - use first letter of domain
            const firstLetter = hostname.charAt(0).toUpperCase();
            const colors = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];
            const colorIndex = hostname.charCodeAt(0) % colors.length;
            const color = colors[colorIndex];
            
            return `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="${encodeURIComponent(color)}"/><text x="12" y="16" text-anchor="middle" fill="white" font-family="Arial" font-size="12" font-weight="bold">${firstLetter}</text></svg>`;
          }
        } catch (e) {
          // Ultimate fallback - generic document icon
          return 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23666"><path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5z"/></svg>';
        }
      }
      
      // Add error handling for favicon loading
      favicon.addEventListener('error', () => {
        // Try domain favicon as fallback
        const domainFavicon = getDomainFaviconUrl(tab.url);
        if (domainFavicon && favicon.src !== domainFavicon) {
          favicon.src = domainFavicon;
        } else {
          // Use generic fallback
          favicon.src = getGenericFavicon(tab.url);
        }
      });
      
      // Add load success handling
      favicon.addEventListener('load', () => {
        favicon.style.opacity = '1';
      });
      
      // Set initial opacity for loading state
      favicon.style.opacity = '0.7';
      
      // Set favicon
      setFaviconWithFallbacks();
      
      const title = document.createElement('div');
      title.textContent = tab.title.length > 20 ? tab.title.substring(0, 20) + '...' : tab.title;
      title.className = 'tab-title';
      title.style.cssText = `
        font-size: 12px;
        font-weight: 500;
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        line-height: 1.4;
      `;
      
      header.appendChild(favicon);
      header.appendChild(title);
      
      // Create preview area
      const preview = document.createElement('div');
      
      if (previewEnabled && tab.screenshot) {
        // Show screenshot if available
        preview.style.cssText = `
          flex: 1;
          background: #f5f5f5;
          border-radius: 4px;
          overflow: hidden;
          position: relative;
        `;

        const previewImg = document.createElement('img');
        previewImg.style.cssText = `
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        `;
        previewImg.setAttribute('src', tab.screenshot);
        previewImg.setAttribute('alt', '');
        preview.appendChild(previewImg);
      } else {
        // Show URL when no preview available or previews are disabled
        preview.style.cssText = `
          flex: 1;
          background: #e5e7eb;
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          color: #6b7280;
          text-align: center;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          flex-direction: column;
          gap: 4px;
          padding: 8px;
        `;
        
        // Display URL instead of just "No preview"
        let displayUrl = tab.url || 'about:blank';
        try {
          const url = new URL(displayUrl);
          displayUrl = url.hostname + url.pathname;
          if (displayUrl.length > 40) {
            displayUrl = displayUrl.substring(0, 37) + '...';
          }
        } catch (e) {
          displayUrl = 'Invalid URL';
        }
        
        const urlText = document.createElement('div');
        urlText.textContent = displayUrl;
        urlText.className = 'tab-url';
        urlText.style.cssText = `
          font-size: 10px;
          word-break: break-all;
          text-align: center;
          line-height: 1.3;
        `;
        
        const statusText = document.createElement('div');
        statusText.textContent = previewEnabled ? 'Preview unavailable' : 'Previews disabled';
        statusText.className = 'tab-status';
        statusText.style.cssText = `
          font-size: 9px;
          text-align: center;
          margin-top: 2px;
        `;
        
        preview.appendChild(urlText);
        preview.appendChild(statusText);
      }
      
      tabElement.appendChild(header);
      tabElement.appendChild(preview);
      
      // Add click handler
      tabElement.addEventListener('click', () => {
        selectedIndex = index;
        switchToTab(tab.id);
      });
      
      // Add hover handler
      tabElement.addEventListener('mouseenter', () => {
        selectedIndex = index;
        updateSelection(selectedIndex);
      });
      
      container.appendChild(tabElement);
      
      // Resolve the promise after the element is fully added to DOM
      setTimeout(resolve, 10);
    });
  });
}

function updateSelection(index) {
  const tabItems = document.querySelectorAll('.tab-item');
  
  // Get current highlight color
  chrome.storage.sync.get(['highlightColor'], function(result) {
    const highlightColor = result.highlightColor || '#3b82f6';
    
    // Convert hex to RGB for alpha transparency
    const r = parseInt(highlightColor.slice(1, 3), 16);
    const g = parseInt(highlightColor.slice(3, 5), 16);
    const b = parseInt(highlightColor.slice(5, 7), 16);
    
    // Create or update dynamic CSS for pseudo-element
    let styleElement = document.getElementById('dynamic-highlight-style');
    if (!styleElement) {
      styleElement = document.createElement('style');
      styleElement.id = 'dynamic-highlight-style';
      document.head.appendChild(styleElement);
    }
    
    styleElement.textContent = `
      .tab-item.selected::before {
        background: ${highlightColor}33 !important;
        border: 4px solid ${highlightColor} !important;
      }
      .tab-item.selected {
        border: 2px solid ${highlightColor} !important;
        box-shadow: 0 4px 16px ${highlightColor}4d !important;
      }
    `;
    
    tabItems.forEach((item, i) => {
      // Remove all selection states first
      item.classList.remove('selected', 'current');
      
      if (i === index) {
        item.classList.add('selected');
      } else {
        item.style.border = '2px solid transparent';
        item.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.1)';
        item.style.background = 'white';
      }
    });
  });
  
  // Scroll selected item into view
  if (tabItems[index]) {
    tabItems[index].scrollIntoView({ behavior: 'auto', inline: 'center', block: 'nearest' });
  }
}

function handleKeyDown(e) {
  if (!tabSwitcherVisible) return;
  
  const tabItems = document.querySelectorAll('.tab-item');
  chrome.storage.sync.get(['maxTabs'], function(result) {
    let maxVisibleTabs = result.maxTabs || 5;
    if (maxVisibleTabs === 'auto') {
      maxVisibleTabs = calculateAutoTabCount();
    }
    maxVisibleTabs = Math.min(currentTabs.length, maxVisibleTabs); // Only cycle through visible tabs
  
    switch(e.key.toLowerCase()) {
    case 'q':
      e.preventDefault();
      selectedIndex = (selectedIndex + 1) % maxVisibleTabs;
      updateSelection(selectedIndex);
      break;
    case 'arrowright':
    case 'arrowdown':
      e.preventDefault();
      selectedIndex = (selectedIndex + 1) % maxVisibleTabs;
      updateSelection(selectedIndex);
      break;
    case 'arrowleft':
    case 'arrowup':
      e.preventDefault();
      selectedIndex = (selectedIndex - 1 + maxVisibleTabs) % maxVisibleTabs;
      updateSelection(selectedIndex);
      break;
    case 'enter':
      e.preventDefault();
      if (tabItems[selectedIndex] && currentTabs[selectedIndex]) {
        switchToTab(currentTabs[selectedIndex].id);
      }
      break;
    case 'escape':
      e.preventDefault();
      hideTabSwitcher();
      break;
  }
  });
}

function switchToTab(tabId) {
  hideTabSwitcher();
  chrome.runtime.sendMessage({
    action: 'switchToTab',
    tabId: tabId
  }, (response) => {
    if (chrome.runtime.lastError) {
      console.error('Error switching tab:', chrome.runtime.lastError);
    }
  });
}

// Global key event listeners for modifier tracking
document.addEventListener('keydown', (e) => {
  if (e.key === 'Control') ctrlPressed = true;
  if (e.key === 'Meta') metaPressed = true;
  if (e.key === 'Shift') shiftPressed = true;
}, true);

document.addEventListener('keyup', handleKeyUp, true);

// Handle global keyup when switcher is open
function handleKeyUp(e) {
  if (e.key === 'Control') ctrlPressed = false;
  if (e.key === 'Meta') metaPressed = false;
  if (e.key === 'Shift') shiftPressed = false;

  if (!tabSwitcherVisible) return;

  // When any modifier key is released, check if all modifier keys are released
  if (e.key === 'Control' || e.key === 'Meta' || e.key === 'Shift') {
    e.preventDefault();

    // Only switch if no modifier keys are being held
    if (!ctrlPressed && !metaPressed && !shiftPressed) {
      const filteredTabs = getFilteredTabs();
      if (filteredTabs[selectedIndex]) {
        switchToTab(filteredTabs[selectedIndex].id);
      }
    }
  }
}

// Reset keys on window blur and close switcher
window.addEventListener('blur', () => {
  ctrlPressed = false;
  shiftPressed = false;
  metaPressed = false;

  // Close switcher when window loses focus (modifier key released outside window)
  if (tabSwitcherVisible) {
    const filteredTabs = getFilteredTabs();
    if (filteredTabs[selectedIndex]) {
      switchToTab(filteredTabs[selectedIndex].id);
    } else {
      hideTabSwitcher();
    }
  }
});

// Get filtered tabs based on search query (currently just returns all tabs)
function getFilteredTabs() {
  return currentTabs;
}

function calculateAutoTabCount() {
  // Get screen information with device pixel ratio awareness
  const screenWidth = window.innerWidth;
  const screenHeight = window.innerHeight;
  const pixelRatio = window.devicePixelRatio || 1;
  const aspectRatio = screenWidth / screenHeight;
  
  // Detect screen size category
  const screenCategory = detectScreenCategory(screenWidth, screenHeight);
  
  // Get performance profile
  const performanceProfile = getPerformanceProfile();
  
  // Calculate base dimensions with responsive scaling
  const baseDimensions = getBaseTabDimensions(screenCategory, pixelRatio);
  const tabWidth = baseDimensions.width;
  const tabHeight = baseDimensions.height;
  const gap = baseDimensions.gap;
  
  // Calculate layout constraints
  const layoutConstraints = getLayoutConstraints(screenCategory, aspectRatio);
  const horizontalPadding = layoutConstraints.horizontalPadding;
  const verticalPadding = layoutConstraints.verticalPadding;
  const maxRows = layoutConstraints.maxRows;
  const maxTabsPerRow = layoutConstraints.maxTabsPerRow;
  
  // Calculate available space
  const availableWidth = screenWidth - horizontalPadding;
  const availableHeight = screenHeight - verticalPadding;
  
  // Calculate tabs per row with aspect ratio optimization
  let tabsPerRow = Math.floor((availableWidth + gap) / (tabWidth + gap));
  tabsPerRow = Math.min(tabsPerRow, maxTabsPerRow);
  
  // Calculate how many rows we can fit
  let possibleRows = Math.floor((availableHeight + gap) / (tabHeight + gap));
  possibleRows = Math.min(possibleRows, maxRows);
  
  // Calculate total tabs with performance optimization
  let totalTabs = tabsPerRow * possibleRows;
  totalTabs = Math.min(totalTabs, performanceProfile.maxTabs);
  
  // Apply minimum and final constraints
  const minTabs = layoutConstraints.minTabs;
  totalTabs = Math.max(totalTabs, minTabs);
  
  return totalTabs;
}

function detectScreenCategory(width, height) {
  const diagonalPixels = Math.sqrt(width * width + height * height);
  const pixelRatio = window.devicePixelRatio || 1;
  const adjustedDiagonal = diagonalPixels * pixelRatio;
  
  if (adjustedDiagonal < 800) return 'mobile';
  if (adjustedDiagonal < 1200) return 'tablet';
  if (adjustedDiagonal < 2000) return 'desktop';
  if (adjustedDiagonal < 3000) return 'large-desktop';
  return '4k-desktop';
}

function getPerformanceProfile() {
  // Detect hardware capabilities
  const navigator = window.navigator;
  const hardwareConcurrency = navigator.hardwareConcurrency || 4;
  const deviceMemory = navigator.deviceMemory || 4;
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  
  // Calculate performance score
  let performanceScore = 0;
  performanceScore += Math.min(hardwareConcurrency / 8, 1) * 40; // CPU score (40%)
  performanceScore += Math.min(deviceMemory / 8, 1) * 30; // Memory score (30%)
  performanceScore += (connection ? (connection.effectiveType ? 1 : 0.5) : 1) * 30; // Network score (30%)
  
  // Determine performance tier
  if (performanceScore >= 80) return { tier: 'high', maxTabs: 20 };
  if (performanceScore >= 60) return { tier: 'medium', maxTabs: 16 };
  if (performanceScore >= 40) return { tier: 'low', maxTabs: 12 };
  return { tier: 'minimal', maxTabs: 8 };
}

function getBaseTabDimensions(screenCategory, pixelRatio) {
  // Base dimensions for different screen categories (optimized for multi-row)
  const baseSizes = {
    'mobile': { width: 120, height: 100, gap: 10 },
    'tablet': { width: 140, height: 120, gap: 12 },
    'desktop': { width: 160, height: 130, gap: 14 },
    'large-desktop': { width: 180, height: 140, gap: 16 },
    '4k-desktop': { width: 200, height: 150, gap: 18 }
  };
  
  const base = baseSizes[screenCategory] || baseSizes['desktop'];
  
  // Apply pixel ratio scaling for crisp rendering
const scaleFactor = Math.max(0.8, Math.min(1.5, 1 / (pixelRatio * 0.8)));
  
  return {
    width: Math.round(base.width * scaleFactor),
    height: Math.round(base.height * scaleFactor),
    gap: Math.round(base.gap * scaleFactor)
  };
}

function getLayoutConstraints(screenCategory, aspectRatio) {
  // Define constraints based on screen category and aspect ratio
  const constraints = {
    'mobile': {
      horizontalPadding: 30,
      verticalPadding: 100,
      maxRows: 3,
      maxTabsPerRow: 2,
      minTabs: 3
    },
    'tablet': {
      horizontalPadding: 40,
      verticalPadding: 120,
      maxRows: 3,
      maxTabsPerRow: 3,
      minTabs: 4
    },
    'desktop': {
      horizontalPadding: 50,
      verticalPadding: 140,
      maxRows: 3,
      maxTabsPerRow: 4,
      minTabs: 4
    },
    'large-desktop': {
      horizontalPadding: 60,
      verticalPadding: 160,
      maxRows: 4,
      maxTabsPerRow: 5,
      minTabs: 6
    },
    '4k-desktop': {
      horizontalPadding: 80,
      verticalPadding: 180,
      maxRows: 4,
      maxTabsPerRow: 6,
      minTabs: 8
    }
  };
  
  const base = constraints[screenCategory] || constraints['desktop'];
  
  // Adjust for ultra-wide or tall screens
  if (aspectRatio > 2.0) {
    // Ultra-wide screen - allow more tabs per row
    base.maxTabsPerRow = Math.floor(base.maxTabsPerRow * 1.3);
  } else if (aspectRatio < 0.6) {
    // Tall screen - allow more rows
    base.maxRows = Math.min(base.maxRows + 1, 4);
    base.verticalPadding = Math.max(base.verticalPadding - 20, 100);
  }
  
  return base;
}

function hideTabSwitcher() {
  // Clear safety timeout
  if (safetyTimeout) {
    clearTimeout(safetyTimeout);
    safetyTimeout = null;
  }

  if (tabSwitcherContainer) {
    tabSwitcherContainer.remove();
    tabSwitcherContainer = null;
  }
  tabSwitcherVisible = false;
  document.removeEventListener('keydown', handleKeyDown);
  
  // Notify background script that switcher is hidden
  chrome.runtime.sendMessage({ action: "switcherHidden" });
}
