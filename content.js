// Content script for Quick Tab Switcher

let tabSwitcherVisible = false;
let tabSwitcherContainer = null;
let tabSwitcherHost = null;
let shadowRoot = null;
let currentTabs = [];
let currentTabId = null;
let selectedIndex = 0;
let currentTheme = 'system';

// Track modifier key states
let ctrlPressed = false;
let shiftPressed = false;
let metaPressed = false;
let altPressed = false;

// Search state
let searchMode = false;
let searchQuery = "";
let searchInputEl = null;
let searchBarEl = null;

// Bookmarks state
let bookmarksMode = false;
let bookmarksQuery = "";
let bookmarksInputEl = null;
let bookmarksBarEl = null;
let currentBookmarks = [];

// Track if we are in direct search mode (all tabs from all windows)
let isDirectSearchMode = false;

// Shared arrow handler for search and bookmarks modes
function handleArrowNavigation(e, getDisplayedItems, onSelectItem, onEscape) {
  console.log('[ARROW DEBUG] Key pressed:', e.key);
  console.log('[ARROW DEBUG] Current selectedIndex:', selectedIndex);
  
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
    const displayed = getDisplayedItems();
    console.log('[ARROW DEBUG] Displayed items count:', displayed.length);
    if (displayed.length > 0) {
      const newIndex = (selectedIndex + 1) % displayed.length;
      console.log('[ARROW DEBUG] Moving forward from', selectedIndex, 'to', newIndex);
      selectedIndex = newIndex;
      updateSelection(selectedIndex);
    }
  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
    const displayed = getDisplayedItems();
    console.log('[ARROW DEBUG] Displayed items count:', displayed.length);
    if (displayed.length > 0) {
      const newIndex = (selectedIndex - 1 + displayed.length) % displayed.length;
      console.log('[ARROW DEBUG] Moving backward from', selectedIndex, 'to', newIndex);
      selectedIndex = newIndex;
      updateSelection(selectedIndex);
    }
  } else if (e.key === 'Enter') {
    const displayed = getDisplayedItems();
    if (displayed.length > 0 && displayed[selectedIndex]) {
      onSelectItem(displayed[selectedIndex]);
    }
  } else if (e.key === 'Escape') {
    onEscape();
  }
}

// Capture-phase keyboard interceptor in the content script world.
// NOTE: This alone cannot stop listeners in the page's main JS world
// (YouTube, Google Docs). Use injectMainWorldBlocker() for hostile sites.
function setupKeyboardInterceptor() {
  console.log('[KEYBOARD DEBUG] Setting up keyboard interceptor');
  const intercept = (e) => {
    console.log('[KEYBOARD DEBUG] Event type:', e.type, 'Key:', e.key);
    console.log('[KEYBOARD DEBUG] tabSwitcherVisible:', tabSwitcherVisible, 'searchMode:', searchMode, 'bookmarksMode:', bookmarksMode);
    
    if (!tabSwitcherVisible) return;
    if (!searchMode && !bookmarksMode) return;
    if (!shadowRoot) return;

    // Only process keydown events for navigation, ignore keyup
    if (e.type !== 'keydown') return;

    // shadowRoot.activeElement gives the real focused element inside the
    // shadow DOM, unlike e.target which is retargeted to the shadow host.
    const activeEl = shadowRoot.activeElement;
    console.log('[KEYBOARD DEBUG] Active element:', activeEl === searchInputEl ? 'searchInputEl' : activeEl === bookmarksInputEl ? 'bookmarksInputEl' : 'other');
    if (activeEl !== searchInputEl && activeEl !== bookmarksInputEl) return;

    const isNavKey = ['ArrowRight','ArrowDown','ArrowLeft','ArrowUp','Enter','Escape','Tab'].includes(e.key);
    e.stopImmediatePropagation();
    if (isNavKey) e.preventDefault();

    if (activeEl === searchInputEl) {
      console.log('[KEYBOARD DEBUG] Calling handleArrowNavigation for search mode');
      handleArrowNavigation(e, getDisplayedTabs, (item) => switchToTab(item.id), hideTabSwitcher);
    } else if (activeEl === bookmarksInputEl) {
      console.log('[KEYBOARD DEBUG] Calling handleArrowNavigation for bookmarks mode');
      handleArrowNavigation(e, getDisplayedBookmarks, (item) => openBookmark(item.url), hideTabSwitcher);
    }
  };

  // document is deeper than window; capture phase on document runs earlier
  document.addEventListener('keydown', intercept, true);
  document.addEventListener('keyup', intercept, true);
  console.log('[KEYBOARD DEBUG] Keyboard interceptor setup complete');
}

// Inject a script into the PAGE's main JS world so that
// stopImmediatePropagation() can reach YouTube / Google Docs listeners.
function injectMainWorldBlocker() {
  const script = document.createElement('script');
  script.textContent = `
    (function() {
      'use strict';
      const blockIfActive = (e) => {
        const host = document.getElementById('tab-switcher-host');
        if (!host) return;
        const shadow = host.shadowRoot;
        if (!shadow) return;

        const searchBar = shadow.getElementById('tab-search-bar');
        const bookmarksBar = shadow.getElementById('bookmarks-search-bar');
        const searchActive  = searchBar  && searchBar.style.display  !== 'none';
        const bookmarksActive = bookmarksBar && bookmarksBar.style.display !== 'none';

        if (searchActive || bookmarksActive) {
          // Stop the event from reaching page listeners (YouTube, Google Docs)
          // but do NOT preventDefault() here — let the input receive typed keys.
          // The content-script interceptor handles preventDefault for nav keys.
          e.stopImmediatePropagation();
        }
      };
      document.addEventListener('keydown', blockIfActive, true);
      document.addEventListener('keyup',   blockIfActive, true);
    })();
  `;
  document.documentElement.appendChild(script);
  script.remove();
}

// Register both interceptors immediately so they win the registration race
setupKeyboardInterceptor();
injectMainWorldBlocker();

const SETTINGS_KEY = 'tabSwitcherSettings';
let currentSettings = {
  maxTabs: 'auto',
  showPreviews: true,
  hideInternalPages: false,
  highlightColor: '#3b82f6',
  theme: 'system',
  searchHotkey: 'F2',
  directSearch: true,
  tabTitleLayout: 'header',
  bookmarksHotkey: 'F4',
  directBookmarks: true,
  previewScale: 100
};

const accentColorMap = {
  blue: '#3b82f6',
  purple: '#8b5cf6',
  pink: '#ec4899',
  red: '#ef4444',
  orange: '#f97316',
  green: '#22c55e',
  teal: '#14b8a6'
};

function detectSystemTheme() {
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

function getEffectiveTheme() {
  return currentSettings.theme === 'system' ? detectSystemTheme() : currentSettings.theme;
}

async function loadSettings() {
  try {
    const result = await chrome.storage.sync.get([SETTINGS_KEY]);
    const settings = result[SETTINGS_KEY];
    if (settings) {
      currentSettings = { ...currentSettings, ...settings };
      if (settings.accentColor && accentColorMap[settings.accentColor]) {
        currentSettings.highlightColor = accentColorMap[settings.accentColor];
      }
    }
  } catch (error) {
    // Silently fail
  }
}

loadSettings();

// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    try {
      if (request.action === "ping") {
        sendResponse({ success: true });
      } else if (request.action === "toggleSwitcher") {
        currentTabs = request.tabs || [];
        currentTabId = request.currentTabId;
        const direction = request.direction || "forward";
        isDirectSearchMode = false; // This is tab switcher mode (current window only)

        await loadSettings();

        if (tabSwitcherVisible) {
          let maxVisibleTabs = currentSettings.maxTabs === 'auto'
            ? calculateAutoTabCount()
            : parseInt(currentSettings.maxTabs, 10) || 5;
          maxVisibleTabs = Math.min(currentTabs.length, maxVisibleTabs);
          if (direction === "forward") {
            selectedIndex = (selectedIndex + 1) % maxVisibleTabs;
          } else {
            selectedIndex = (selectedIndex - 1 + maxVisibleTabs) % maxVisibleTabs;
          }
          updateSelection(selectedIndex);
        } else {
          let maxVisibleTabs = currentSettings.maxTabs === 'auto'
            ? calculateAutoTabCount()
            : parseInt(currentSettings.maxTabs, 10) || 5;
          maxVisibleTabs = Math.min(currentTabs.length, maxVisibleTabs);
          if (direction === "forward") {
            selectedIndex = maxVisibleTabs > 1 ? 1 : 0;
          } else {
            selectedIndex = maxVisibleTabs > 1 ? maxVisibleTabs - 1 : 0;
          }
          await showTabSwitcher();
        }
        sendResponse({ success: true });
      } else if (request.action === 'openDirectSearch' && currentSettings.directSearch) {
        if (tabSwitcherVisible) {
          sendResponse({ success: false, error: 'Switcher already visible' });
          return;
        }
        try {
          await openDirectSearch();
          sendResponse({ success: true });
        } catch (err) {
          console.error('openDirectSearch failed:', err);
          sendResponse({ success: false, error: err.message });
        }
      } else if (request.action === 'openDirectBookmarks' && currentSettings.directBookmarks) {
        if (tabSwitcherVisible) {
          sendResponse({ success: false, error: 'Switcher already visible' });
          return;
        }
        try {
          await openDirectBookmarks();
          sendResponse({ success: true });
        } catch (err) {
          console.error('openDirectBookmarks failed:', err);
          sendResponse({ success: false, error: err.message });
        }
      }
    } catch (error) {
      console.error("Error in message listener:", error);
      sendResponse({ success: false, error: error.message });
    }
  })();
  return true;
});

async function showTabSwitcher() {
  if (tabSwitcherVisible) return;
  tabSwitcherVisible = true;

  chrome.runtime.sendMessage({ action: "switcherShown" });

  tabSwitcherHost = document.createElement('div');
  tabSwitcherHost.id = 'tab-switcher-host';
  tabSwitcherHost.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: 999999;';

  shadowRoot = tabSwitcherHost.attachShadow({ mode: 'open' });

  const styleLink = document.createElement('link');
  styleLink.rel = 'stylesheet';
  styleLink.href = chrome.runtime.getURL('styles.css');
  shadowRoot.appendChild(styleLink);

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

  const switcherContainer = document.createElement('div');
  switcherContainer.id = 'tab-switcher-container';

  // Set initial row class based on mode
  updateContainerRowClass(switcherContainer);

  tabSwitcherContainer.appendChild(switcherContainer);
  shadowRoot.appendChild(tabSwitcherContainer);
  document.body.appendChild(tabSwitcherHost);

  // Wait for styles to load before rendering
  await new Promise((resolve) => {
    styleLink.onload = resolve;
    styleLink.onerror = resolve;
    setTimeout(resolve, 100);
  });

  // Inject scale CSS custom property
  const scale = (currentSettings.previewScale || 100) / 100;
  const scaleStyle = document.createElement('style');
  scaleStyle.textContent = `:host { --tab-scale: ${scale}; }`;
  shadowRoot.appendChild(scaleStyle);

  // Search bar
  searchBarEl = document.createElement('div');
  searchBarEl.id = 'tab-search-bar';
  searchBarEl.style.cssText = `
    position: absolute;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 1000000;
    display: none;
    background: rgba(255, 255, 255, 0.95);
    border-radius: 8px;
    padding: 8px 16px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
    min-width: 280px;
  `;
  searchInputEl = document.createElement('input');
  searchInputEl.type = 'text';
  searchInputEl.placeholder = isDirectSearchMode ? 'Search all tabs...' : 'Search tabs in this window...';
  searchInputEl.style.cssText = `
    border: none;
    outline: none;
    background: transparent;
    font-size: 14px;
    width: 100%;
    color: #333;
  `;
  searchInputEl.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    updateSearchFilter();
  });
  searchBarEl.appendChild(searchInputEl);
  tabSwitcherContainer.appendChild(searchBarEl);

  // Bookmarks bar
  bookmarksBarEl = document.createElement('div');
  bookmarksBarEl.id = 'bookmarks-search-bar';
  bookmarksBarEl.style.cssText = `
    position: absolute;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 1000000;
    display: none;
    background: rgba(255, 255, 255, 0.95);
    border-radius: 8px;
    padding: 8px 16px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
    min-width: 280px;
  `;
  
  // Path display container
  const pathContainer = document.createElement('div');
  pathContainer.style.cssText = `
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
    font-size: 12px;
    color: #666;
  `;
  
  const pathLabel = document.createElement('span');
  pathLabel.textContent = 'bookmarks';
  pathLabel.style.cssText = `
    font-weight: 500;
    color: #6b7280;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-right: 8px;
  `;
  
  const pathSeparator = document.createElement('span');
  pathSeparator.textContent = '/';
  pathSeparator.style.cssText = `
    color: #999;
  `;
  
  const currentPath = document.createElement('span');
  currentPath.id = 'current-folder-path';
  currentPath.textContent = '';
  currentPath.style.cssText = `
    color: #666;
    font-style: italic;
  `;
  
  pathContainer.appendChild(pathLabel);
  pathContainer.appendChild(pathSeparator);
  pathContainer.appendChild(currentPath);
  
  bookmarksInputEl = document.createElement('input');
  bookmarksInputEl.type = 'text';
  bookmarksInputEl.placeholder = 'Search bookmarks...';
  bookmarksInputEl.style.cssText = `
    border: none;
    outline: none;
    background: transparent;
    font-size: 14px;
    width: 100%;
    color: #333;
  `;
  bookmarksInputEl.addEventListener('input', (e) => {
    bookmarksQuery = e.target.value;
    updateBookmarksPath();
    updateBookmarksFilter();
  });
  
  bookmarksBarEl.appendChild(pathContainer);
  bookmarksBarEl.appendChild(bookmarksInputEl);
  tabSwitcherContainer.appendChild(bookmarksBarEl);

  applyTheme();
  
  // Render tabs based on mode (direct search vs tab switcher)
  if (isDirectSearchMode) {
    // Direct search mode - show all tabs with auto layout
    createTabElementsAutoLayout(getDisplayedTabs(), switcherContainer, false);
  } else {
    // Regular tab switcher mode - respect maxTabs setting
    const maxTabs = currentSettings.maxTabs === 'auto'
      ? calculateAutoTabCount()
      : parseInt(currentSettings.maxTabs, 10) || 5;
    createTabElements(currentTabs.slice(0, maxTabs), switcherContainer, false);
  }

  document.addEventListener('keydown', handleKeyDown);

  // Click handler for closing the entire menu when clicking outside
  tabSwitcherContainer.addEventListener('click', (e) => {
    // If clicking directly on the overlay background (not on any child element)
    if (e.target === tabSwitcherContainer) {
      // Close the entire menu immediately
      hideTabSwitcher();
    }
  });
}

function updateContainerRowClass(container) {
  // Remove existing row classes
  container.classList.remove('single-row', 'two-row', 'three-row', 'four-row');
  
  // Calculate optimal number of rows based on screen size
  const screenWidth = window.innerWidth;
  const screenHeight = window.innerHeight;
  const tabWidth = 180;
  const tabHeight = 130;
  const gap = 14;
  const horizontalPadding = 60;
  const verticalPadding = 120;
  const maxRows = 4;
  
  const availableHeight = screenHeight - verticalPadding;
  let possibleRows = Math.floor((availableHeight + gap) / (tabHeight + gap));
  possibleRows = Math.min(possibleRows, maxRows);
  
  // Add appropriate row class based on calculated rows
  if (possibleRows <= 1) {
    container.classList.add('single-row');
  } else if (possibleRows === 2) {
    container.classList.add('two-row');
  } else if (possibleRows === 3) {
    container.classList.add('three-row');
  } else {
    container.classList.add('four-row');
  }
}

function createTabElementsAutoLayout(tabs, container, compact = false) {
  container.innerHTML = '';

  if (selectedIndex >= tabs.length) {
    selectedIndex = Math.max(0, tabs.length - 1);
  }

  // Update container row class for auto layout
  updateContainerRowClass(container);
  
  // Set CSS variable for scale
  const scale = (currentSettings.previewScale || 100) / 100;
  container.style.setProperty('--tab-scale', scale);

  tabs.forEach((tab, index) => {
    const tabElement = document.createElement('div');
    tabElement.className = 'tab-item';
    if (compact) {
      tabElement.classList.add('compact');
    }
    if (tab.id === currentTabId) {
      tabElement.classList.add('current');
    }
    tabElement.dataset.tabId = tab.id;
    tabElement.dataset.index = index;

    // Header: favicon + title
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
    favicon.src = tab.favIconUrl || getDomainFavicon(tab.url);
    favicon.addEventListener('error', () => {
      favicon.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="%23888"/></svg>';
    });

    const title = document.createElement('div');
    title.textContent = (tab.title || 'Untitled').length > 20 ? (tab.title || 'Untitled').substring(0, 20) + '...' : (tab.title || 'Untitled');
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

    tabElement.appendChild(header);

    // Move header to footer if tabTitleLayout is set to footer
    if (currentSettings.tabTitleLayout === 'footer') {
      header.style.order = '2';
      header.style.borderTop = '1px solid #eee';
      header.style.borderBottom = 'none';
    } else {
      header.style.order = '';
      header.style.borderTop = '';
      header.style.borderBottom = '1px solid #eee';
    }

    // Preview area (hidden in compact/search mode)
    if (!compact) {
      const preview = document.createElement('div');
      preview.style.cssText = `
        flex: 1;
        border-radius: 4px;
        overflow: hidden;
        position: relative;
      `;

      if (currentSettings.showPreviews && tab.screenshot) {
        preview.style.background = '#f5f5f5';
        const previewImg = document.createElement('img');
        previewImg.style.cssText = `
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        `;
        previewImg.src = tab.screenshot;
        previewImg.setAttribute('alt', '');
        preview.appendChild(previewImg);
      } else {
        // Fallback: show domain/URL text
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

        let displayUrl = tab.url || 'about:blank';
        try {
          const url = new URL(displayUrl);
          displayUrl = url.hostname + url.pathname;
          if (displayUrl.length > 40) displayUrl = displayUrl.substring(0, 37) + '...';
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
        statusText.textContent = currentSettings.showPreviews ? 'Preview unavailable' : 'Previews disabled';
        statusText.className = 'tab-status';
        statusText.style.cssText = `
          font-size: 9px;
          text-align: center;
          margin-top: 2px;
        `;

        preview.appendChild(urlText);
        preview.appendChild(statusText);
      }

      tabElement.appendChild(preview);
    }

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'tab-close';
    closeBtn.title = 'Close tab';
    closeBtn.innerHTML = '&#10005;';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeTab(tab.id, tabElement);
    });

    tabElement.appendChild(closeBtn);

    tabElement.addEventListener('click', () => {
      selectedIndex = index;
      switchToTab(tab.id);
    });

    tabElement.addEventListener('mouseenter', () => {
      selectedIndex = index;
      updateSelection(selectedIndex);
    });

    container.appendChild(tabElement);
  });

  setTimeout(() => updateSelection(selectedIndex), 50);
}

function createTabElements(tabs, container, compact = false) {
  container.innerHTML = '';

  if (selectedIndex >= tabs.length) {
    selectedIndex = Math.max(0, tabs.length - 1);
  }

  tabs.forEach((tab, index) => {
    const tabElement = document.createElement('div');
    tabElement.className = 'tab-item';
    if (compact) {
      tabElement.classList.add('compact');
    }
    if (tab.id === currentTabId) {
      tabElement.classList.add('current');
    }
    tabElement.dataset.tabId = tab.id;
    tabElement.dataset.index = index;

    // Header: favicon + title
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
    favicon.src = tab.favIconUrl || getDomainFavicon(tab.url);
    favicon.addEventListener('error', () => {
      favicon.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="%23888"/></svg>';
    });

    const title = document.createElement('div');
    title.textContent = (tab.title || 'Untitled').length > 20 ? (tab.title || 'Untitled').substring(0, 20) + '...' : (tab.title || 'Untitled');
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

    tabElement.appendChild(header);

    // Move header to footer if tabTitleLayout is set to footer
    if (currentSettings.tabTitleLayout === 'footer') {
      header.style.order = '2'; // Move after preview
      header.style.borderTop = '1px solid #eee'; // Add divider above
      header.style.borderBottom = 'none'; // Remove divider below
    } else {
      // Reset to header layout
      header.style.order = ''; // Reset to default
      header.style.borderTop = ''; // Remove top border
      header.style.borderBottom = '1px solid #eee'; // Restore bottom border
    }

    // Preview area (hidden in compact/search mode)
    if (!compact) {
      const preview = document.createElement('div');
      preview.style.cssText = `
        flex: 1;
        border-radius: 4px;
        overflow: hidden;
        position: relative;
      `;

      if (currentSettings.showPreviews && tab.screenshot) {
        preview.style.background = '#f5f5f5';
        const previewImg = document.createElement('img');
        previewImg.style.cssText = `
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        `;
        previewImg.src = tab.screenshot;
        previewImg.setAttribute('alt', '');
        preview.appendChild(previewImg);
      } else {
        // Fallback: show domain/URL text
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

        let displayUrl = tab.url || 'about:blank';
        try {
          const url = new URL(displayUrl);
          displayUrl = url.hostname + url.pathname;
          if (displayUrl.length > 40) displayUrl = displayUrl.substring(0, 37) + '...';
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
        statusText.textContent = currentSettings.showPreviews ? 'Preview unavailable' : 'Previews disabled';
        statusText.className = 'tab-status';
        statusText.style.cssText = `
          font-size: 9px;
          text-align: center;
          margin-top: 2px;
        `;

        preview.appendChild(urlText);
        preview.appendChild(statusText);
      }

      tabElement.appendChild(preview);
    }

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'tab-close';
    closeBtn.title = 'Close tab';
    closeBtn.innerHTML = '&#10005;';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeTab(tab.id, tabElement);
    });

    tabElement.appendChild(closeBtn);

    tabElement.addEventListener('click', () => {
      selectedIndex = index;
      switchToTab(tab.id);
    });

    tabElement.addEventListener('mouseenter', () => {
      selectedIndex = index;
      updateSelection(selectedIndex);
    });

    container.appendChild(tabElement);
  });

  setTimeout(() => updateSelection(selectedIndex), 50);
}

function getDomainFavicon(url) {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.hostname}/favicon.ico`;
  } catch (e) {
    return '';
  }
}

function updateSelection(index) {
  const tabItems = shadowRoot ? shadowRoot.querySelectorAll('.tab-item') : [];

  const highlightColor = currentSettings.highlightColor || '#3b82f6';
  const r = parseInt(highlightColor.slice(1, 3), 16);
  const g = parseInt(highlightColor.slice(3, 5), 16);
  const b = parseInt(highlightColor.slice(5, 7), 16);

  let styleElement = shadowRoot ? shadowRoot.getElementById('dynamic-highlight-style') : null;
  if (!styleElement && shadowRoot) {
    styleElement = document.createElement('style');
    styleElement.id = 'dynamic-highlight-style';
    shadowRoot.appendChild(styleElement);
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
    item.classList.remove('selected', 'current');
    if (i === index) {
      item.classList.add('selected');
    } else {
      item.style.border = '2px solid transparent';
      item.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.1)';
      item.style.background = 'white';
    }
  });

  if (tabItems[index]) {
    tabItems[index].scrollIntoView({ behavior: 'auto', inline: 'center', block: 'nearest' });
  }
}

function handleKeyDown(e) {
  if (!tabSwitcherVisible) return;

  const displayedTabs = getDisplayedTabs();
  const maxVisible = displayedTabs.length;

  switch (e.key.toLowerCase()) {
    case currentSettings.searchHotkey.toLowerCase():
      e.preventDefault();
      toggleSearchMode();
      break;
    case currentSettings.bookmarksHotkey.toLowerCase():
      e.preventDefault();
      toggleBookmarksMode();
      break;
    case 'arrowright':
    case 'arrowdown':
      e.preventDefault();
      if (maxVisible > 0) {
        selectedIndex = (selectedIndex + 1) % maxVisible;
        updateSelection(selectedIndex);
      }
      break;
    case 'arrowleft':
    case 'arrowup':
      e.preventDefault();
      if (maxVisible > 0) {
        selectedIndex = (selectedIndex - 1 + maxVisible) % maxVisible;
        updateSelection(selectedIndex);
      }
      break;
    case 'enter':
      e.preventDefault();
      if (displayedTabs[selectedIndex]) {
        switchToTab(displayedTabs[selectedIndex].id);
      }
      break;
    case 'escape':
      e.preventDefault();
      hideTabSwitcher(); // Directly close the entire menu on Escape
      break;
  }
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

function closeTab(tabId, tabElement) {
  chrome.runtime.sendMessage({
    action: 'closeTab',
    tabId: tabId
  }, (response) => {
    if (chrome.runtime.lastError) {
      console.error('Error closing tab:', chrome.runtime.lastError);
      return;
    }
    if (response && response.success) {
      // Remove from local array and DOM
      const idx = currentTabs.findIndex(t => t.id === tabId);
      if (idx !== -1) {
        currentTabs.splice(idx, 1);
      }
      if (tabElement && tabElement.parentNode) {
        tabElement.remove();
      }
      // Adjust selection if needed
      if (selectedIndex >= currentTabs.length && currentTabs.length > 0) {
        selectedIndex = currentTabs.length - 1;
      }
      if (currentTabs.length === 0) {
        hideTabSwitcher();
      } else if (searchMode) {
        updateSearchFilter();
      } else {
        updateSelection(selectedIndex);
      }
    }
  });
}

function getDisplayedTabs() {
  if (!searchMode || !searchQuery.trim()) {
    // In direct search mode, return ALL tabs (no limit)
    if (isDirectSearchMode) {
      return currentTabs;
    }
    // In regular tab switcher mode, respect maxTabs setting
    let maxTabs = currentSettings.maxTabs === 'auto'
      ? calculateAutoTabCount()
      : parseInt(currentSettings.maxTabs, 10) || 5;
    return currentTabs.slice(0, maxTabs);
  }
  const query = searchQuery.toLowerCase().trim();
  // In search mode, return ALL matching tabs (no limit for direct search)
  return currentTabs.filter(tab => {
    const title = (tab.title || '').toLowerCase();
    return title.includes(query);
  });
}

function toggleSearchMode() {
  if (!shadowRoot) return;
  searchMode = !searchMode;
  const container = shadowRoot.getElementById('tab-switcher-container');
  if (!container) return;

  if (searchMode) {
    if (searchBarEl) searchBarEl.style.display = 'block';
    if (searchInputEl) {
      searchInputEl.value = '';
      searchInputEl.placeholder = isDirectSearchMode ? 'Search all tabs...' : 'Search tabs in this window...';
      searchInputEl.focus();
    }
    searchQuery = '';
    selectedIndex = 0;
    
    // Use auto layout for search results in direct search mode
    if (isDirectSearchMode) {
      createTabElementsAutoLayout(getDisplayedTabs(), container, false);
    } else {
      createTabElements(getDisplayedTabs(), container, false);
    }
    updateSelection(0);
  } else {
    exitSearchMode();
  }
}

function exitSearchMode() {
  if (!searchMode) return;
  if (!shadowRoot) return;
  searchMode = false;
  searchQuery = '';
  if (searchBarEl) searchBarEl.style.display = 'none';
  if (searchInputEl) searchInputEl.blur();

  const container = shadowRoot.getElementById('tab-switcher-container');
  if (container) {
    selectedIndex = 0;
    if (isDirectSearchMode) {
      // Direct search mode - show all tabs with auto layout
      createTabElementsAutoLayout(currentTabs, container, false);
    } else {
      // Regular tab switcher mode - respect maxTabs setting
      let maxTabs = currentSettings.maxTabs === 'auto'
        ? calculateAutoTabCount()
        : parseInt(currentSettings.maxTabs, 10) || 5;
      createTabElements(currentTabs.slice(0, maxTabs), container, false);
    }
    updateSelection(0);
  }
}

function updateSearchFilter() {
  if (!searchMode || !shadowRoot) return;
  const container = shadowRoot.getElementById('tab-switcher-container');
  if (!container) return;

  selectedIndex = 0;
  // Use auto layout for search results in direct search mode
  if (isDirectSearchMode) {
    createTabElementsAutoLayout(getDisplayedTabs(), container, false);
  } else {
    createTabElements(getDisplayedTabs(), container, false);
  }
  updateSelection(0);
}

async function openDirectSearch() {
  // Get all tabs from ALL windows (not just current window)
  const response = await chrome.runtime.sendMessage({ action: "getAllTabs" });
  if (response && response.tabs) {
    currentTabs = response.tabs;
    currentTabId = response.currentTabId;
    isDirectSearchMode = true; // Set flag for direct search mode
    
    await loadSettings();
    await showTabSwitcher();
    
    // Immediately enter search mode
    setTimeout(() => {
      toggleSearchMode();
    }, 100);
  }
}

function getDisplayedBookmarks() {
  if (!bookmarksMode) return currentBookmarks;
  
  const query = bookmarksQuery.trim();
  if (!query) return currentBookmarks; // Return ALL bookmarks, not limited
  
  // Check if it's a path query (starts with /)
  if (query.startsWith('/')) {
    const parts = query.substring(1).split(' ');
    const pathQuery = parts[0].toLowerCase();
    const titleQuery = parts.slice(1).join(' ').toLowerCase();
    
    return currentBookmarks.filter(bookmark => {
      // First filter by path
      const path = (bookmark.path || '').toLowerCase();
      if (!path.includes(pathQuery)) return false;
      
      // Then filter by title if there's a search query
      if (titleQuery) {
        const title = (bookmark.title || '').toLowerCase();
        return title.includes(titleQuery);
      }
      
      return true;
    });
  }
  
  // Regular title search - return all matching bookmarks
  const titleQuery = query.toLowerCase();
  return currentBookmarks.filter(bookmark => {
    const title = (bookmark.title || '').toLowerCase();
    return title.includes(titleQuery);
  });
}

function updateBookmarksPath() {
  if (!shadowRoot) return;
  const pathDisplay = shadowRoot.getElementById('current-folder-path');
  if (!pathDisplay) return;
  
  const query = bookmarksQuery.trim();
  if (query.startsWith('/')) {
    const parts = query.substring(1).split(' ');
    const pathPart = parts[0];
    const searchPart = parts.slice(1).join(' ');
    
    if (searchPart) {
      pathDisplay.textContent = `${pathPart} → "${searchPart}"`;
    } else {
      pathDisplay.textContent = pathPart;
    }
  } else {
    pathDisplay.textContent = '';
  }
}

function toggleBookmarksMode() {
  if (!shadowRoot) return;
  bookmarksMode = !bookmarksMode;
  const container = shadowRoot.getElementById('tab-switcher-container');
  if (!container) return;

  if (bookmarksMode) {
    if (bookmarksBarEl) bookmarksBarEl.style.display = 'block';
    if (bookmarksInputEl) {
      bookmarksInputEl.value = '';
      bookmarksInputEl.focus();
    }
    bookmarksQuery = '';
    selectedIndex = 0;
    createBookmarkElements(getDisplayedBookmarks(), container);
    updateSelection(0);
  } else {
    exitBookmarksMode();
  }
}

function exitBookmarksMode() {
  if (!bookmarksMode) return;
  if (!shadowRoot) return;
  bookmarksMode = false;
  bookmarksQuery = '';
  if (bookmarksBarEl) bookmarksBarEl.style.display = 'none';
  if (bookmarksInputEl) bookmarksInputEl.blur();

  // If we opened directly in bookmarks mode, close the switcher entirely
  if (currentBookmarks.length > 0 && currentTabs.length === 0) {
    hideTabSwitcher();
    return;
  }

  const container = shadowRoot.getElementById('tab-switcher-container');
  if (container) {
    selectedIndex = 0;
    if (isDirectSearchMode) {
      createTabElementsAutoLayout(currentTabs, container, false);
    } else {
      let maxTabs = currentSettings.maxTabs === 'auto'
        ? calculateAutoTabCount()
        : parseInt(currentSettings.maxTabs, 10) || 5;
      createTabElements(currentTabs.slice(0, maxTabs), container, false);
    }
    updateSelection(0);
  }
}

function updateBookmarksFilter() {
  if (!bookmarksMode || !shadowRoot) return;
  const container = shadowRoot.getElementById('tab-switcher-container');
  if (!container) return;

  selectedIndex = 0;
  createBookmarkElements(getDisplayedBookmarks(), container);
  updateSelection(0);
}

async function openDirectBookmarks() {
  const response = await chrome.runtime.sendMessage({ action: "getAllBookmarks" });
  if (response && response.bookmarks) {
    currentBookmarks = response.bookmarks;
    
    await loadSettings();
    await showTabSwitcher();
    
    // Mark this as direct bookmarks mode
    currentTabs = []; // Clear tabs to indicate direct bookmarks mode
    isDirectSearchMode = false;
    
    setTimeout(() => {
      toggleBookmarksMode();
    }, 100);
  }
}

function openBookmark(url) {
  console.log('[BOOKMARK DEBUG] Opening bookmark:', url);
  hideTabSwitcher();
  chrome.runtime.sendMessage({ action: 'openBookmark', url: url }, (response) => {
    console.log('[BOOKMARK DEBUG] Bookmark opened response:', response);
  });
}

function createBookmarkElements(bookmarks, container) {
  container.innerHTML = '';

  if (selectedIndex >= bookmarks.length) {
    selectedIndex = Math.max(0, bookmarks.length - 1);
  }

  // Always use multi-row layout for bookmarks (like Auto mode for tabs)
  updateContainerRowClass(container);
  
  // Set CSS variable for scale
  const scale = (currentSettings.previewScale || 100) / 100;
  container.style.setProperty('--tab-scale', scale);

  bookmarks.forEach((bookmark, index) => {
    const bookmarkElement = document.createElement('div');
    bookmarkElement.className = 'tab-item';
    bookmarkElement.classList.add('bookmark-item');
    bookmarkElement.dataset.bookmarkId = bookmark.id;
    bookmarkElement.dataset.index = index;

    // Header: favicon + title
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
    // Try to load favicon with proper Chrome API
    favicon.src = `chrome://favicon/${bookmark.url}`;
    favicon.addEventListener('error', () => {
      // Fallback to domain-based favicon
      try {
        const url = new URL(bookmark.url);
        favicon.src = `https://www.google.com/s2/favicons?domain=${url.hostname}&sz=16`;
      } catch (e) {
        // Final fallback to generic icon
        favicon.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="%23888"/></svg>';
      }
    });

    const title = document.createElement('div');
    title.textContent = (bookmark.title || 'Untitled').length > 20 ? (bookmark.title || 'Untitled').substring(0, 20) + '...' : (bookmark.title || 'Untitled');
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
    
    // Move header to footer if tabTitleLayout is set to footer
    if (currentSettings.tabTitleLayout === 'footer') {
      header.style.order = '2';
      header.style.borderTop = '1px solid #eee';
      header.style.borderBottom = 'none';
    } else {
      header.style.order = '';
      header.style.borderTop = '';
      header.style.borderBottom = '1px solid #eee';
    }
    
    bookmarkElement.appendChild(header);
    
    // Add folder path if available
    if (bookmark.path && bookmark.path !== 'Bookmarks') {
      const pathElement = document.createElement('div');
      pathElement.textContent = bookmark.path;
      pathElement.className = 'bookmark-path';
      pathElement.style.cssText = `
        font-size: 10px;
        color: #6b7280;
        margin-bottom: 4px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      `;
      bookmarkElement.appendChild(pathElement);
    }

    // Preview area
    const preview = document.createElement('div');
    preview.style.cssText = `
      flex: 1;
      border-radius: 4px;
      overflow: hidden;
      position: relative;
    `;
    preview.style.background = '#e5e7eb';
    preview.style.cssText += `
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

    let displayUrl = bookmark.url || 'about:blank';
    try {
      const url = new URL(displayUrl);
      displayUrl = url.hostname + url.pathname;
      if (displayUrl.length > 40) displayUrl = displayUrl.substring(0, 37) + '...';
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
    statusText.textContent = 'Bookmark';
    statusText.className = 'tab-status';
    statusText.style.cssText = `
      font-size: 9px;
      text-align: center;
      margin-top: 2px;
    `;

    preview.appendChild(urlText);
    preview.appendChild(statusText);
    bookmarkElement.appendChild(preview);

    // Close button (optional for bookmarks)
    const closeBtn = document.createElement('button');
    closeBtn.className = 'tab-close';
    closeBtn.title = 'Open bookmark';
    closeBtn.innerHTML = '&#10005;';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      // For bookmarks, close button does nothing
    });
    bookmarkElement.appendChild(closeBtn);

    bookmarkElement.addEventListener('click', () => {
      selectedIndex = index;
      openBookmark(bookmark.url);
    });

    bookmarkElement.addEventListener('mouseenter', () => {
      selectedIndex = index;
      updateSelection(selectedIndex);
    });

    container.appendChild(bookmarkElement);
  });

  setTimeout(() => updateSelection(selectedIndex), 50);
}

// Add window resize handler to reflow bookmarks and direct search
let resizeTimeout;
window.addEventListener('resize', () => {
  if (!tabSwitcherVisible) return;
  
  // Debounce resize events
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => {
    const container = shadowRoot ? shadowRoot.getElementById('tab-switcher-container') : null;
    if (container) {
      if (bookmarksMode) {
        createBookmarkElements(getDisplayedBookmarks(), container);
      } else if (isDirectSearchMode || searchMode) {
        createTabElementsAutoLayout(getDisplayedTabs(), container, false);
      } else if (!searchMode && !bookmarksMode) {
        if (isDirectSearchMode) {
          createTabElementsAutoLayout(currentTabs, container, false);
        } else {
          let maxTabs = currentSettings.maxTabs === 'auto'
            ? calculateAutoTabCount()
            : parseInt(currentSettings.maxTabs, 10) || 5;
          createTabElements(currentTabs.slice(0, maxTabs), container, false);
        }
      }
    }
  }, 200);
});

// Global key event listeners for modifier tracking
document.addEventListener('keydown', (e) => {
  if (e.key === 'Control') ctrlPressed = true;
  if (e.key === 'Meta') metaPressed = true;
  if (e.key === 'Shift') shiftPressed = true;
  if (e.key === 'Alt') altPressed = true;

  // Handle direct search hotkey (without opening switcher first)
  if (currentSettings.directSearch && e.key === currentSettings.searchHotkey && !tabSwitcherVisible) {
    e.preventDefault();
    openDirectSearch();
  }

  // Handle direct bookmarks hotkey
  if (currentSettings.directBookmarks && e.key === currentSettings.bookmarksHotkey && !tabSwitcherVisible) {
    e.preventDefault();
    openDirectBookmarks();
  }
}, true);

document.addEventListener('keyup', handleKeyUp, true);

function handleKeyUp(e) {
  if (e.key === 'Control') ctrlPressed = false;
  if (e.key === 'Meta') metaPressed = false;
  if (e.key === 'Shift') shiftPressed = false;
  if (e.key === 'Alt') altPressed = false;

  if (!tabSwitcherVisible) return;

  if (e.key === 'Control' || e.key === 'Meta' || e.key === 'Shift' || e.key === 'Alt') {
    e.preventDefault();
    if (searchMode || bookmarksMode) {
      // Don't switch tabs when releasing hotkey in search or bookmarks mode
      return;
    }
    const displayed = getDisplayedTabs();
    if (displayed[selectedIndex]) {
      switchToTab(displayed[selectedIndex].id);
    }
  }
}

// Reset keys on window blur and close switcher
window.addEventListener('blur', () => {
  ctrlPressed = false;
  shiftPressed = false;
  metaPressed = false;
  altPressed = false;

  if (tabSwitcherVisible) {
    // Close the entire menu when window loses focus
    hideTabSwitcher();
  }
});

function applyTheme() {
  const effectiveTheme = getEffectiveTheme();
  const overlay = shadowRoot ? shadowRoot.getElementById('tab-switcher-overlay') : null;
  if (overlay) {
    if (effectiveTheme === 'dark') {
      overlay.classList.add('dark-mode');
    } else {
      overlay.classList.remove('dark-mode');
    }
  }
}

function calculateAutoTabCount() {
  const screenWidth = window.innerWidth;
  const screenHeight = window.innerHeight;
  const tabWidth = 180;
  const tabHeight = 130;
  const gap = 14;

  const horizontalPadding = 60;
  const verticalPadding = 120;
  const maxRows = 4;
  const maxTabsPerRow = 6;

  const availableWidth = screenWidth - horizontalPadding;
  const availableHeight = screenHeight - verticalPadding;

  let tabsPerRow = Math.floor((availableWidth + gap) / (tabWidth + gap));
  tabsPerRow = Math.min(tabsPerRow, maxTabsPerRow);

  let possibleRows = Math.floor((availableHeight + gap) / (tabHeight + gap));
  possibleRows = Math.min(possibleRows, maxRows);

  return Math.max(tabsPerRow * possibleRows, 4);
}

function hideTabSwitcher() {
  searchMode = false;
  searchQuery = '';
  bookmarksMode = false;
  bookmarksQuery = '';
  isDirectSearchMode = false;

  if (tabSwitcherHost) {
    tabSwitcherHost.remove();
    tabSwitcherHost = null;
  }
  shadowRoot = null;
  tabSwitcherContainer = null;
  searchBarEl = null;
  searchInputEl = null;
  bookmarksBarEl = null;
  bookmarksInputEl = null;
  currentBookmarks = [];
  tabSwitcherVisible = false;
  document.removeEventListener('keydown', handleKeyDown);

  chrome.runtime.sendMessage({ action: "switcherHidden" });
}