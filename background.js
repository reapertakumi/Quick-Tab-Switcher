// Track MRU (Most Recently Used) tab order
let mruTabOrder = [];
const MRU_CACHE_KEY = 'mruTabOrderV1';

// Persisted screenshot cache using local storage
const SCREENSHOT_CACHE_KEY = 'tabScreenshotCacheV2';
const MAX_SCREENSHOT_CACHE_ITEMS = 25;
let tabScreenshotCache = new Map();
const cacheInitPromise = loadScreenshotCache();

async function loadScreenshotCache() {
  try {
    const stored = await chrome.storage.local.get(SCREENSHOT_CACHE_KEY);
    const entries = stored[SCREENSHOT_CACHE_KEY];
    if (entries && typeof entries === 'object') {
      Object.entries(entries).forEach(([id, entry]) => {
        if (entry && entry.dataUrl) {
          tabScreenshotCache.set(Number(id), entry);
        }
      });
    }
  } catch (error) {
    console.warn('Failed to load screenshot cache', error);
  }
}

async function persistScreenshotCache() {
  const plainObject = {};
  for (const [id, entry] of tabScreenshotCache.entries()) {
    plainObject[id] = entry;
  }
  try {
    await chrome.storage.local.set({ [SCREENSHOT_CACHE_KEY]: plainObject });
  } catch (error) {
    console.warn('Failed to persist screenshot cache', error);
  }
}

async function pruneScreenshotCache() {
  if (tabScreenshotCache.size <= MAX_SCREENSHOT_CACHE_ITEMS) return;
  const entries = Array.from(tabScreenshotCache.entries());
  entries.sort((a, b) => (a[1].timestamp || 0) - (b[1].timestamp || 0));
  while (tabScreenshotCache.size > MAX_SCREENSHOT_CACHE_ITEMS && entries.length) {
    const [oldestId] = entries.shift();
    tabScreenshotCache.delete(oldestId);
  }
  await persistScreenshotCache();
}

async function setScreenshot(tabId, dataUrl, url = null) {
  await cacheInitPromise;
  tabScreenshotCache.set(tabId, { dataUrl, timestamp: Date.now(), url });
  await pruneScreenshotCache();
  await persistScreenshotCache();
}

async function deleteScreenshot(tabId) {
  await cacheInitPromise;
  tabScreenshotCache.delete(tabId);
  await persistScreenshotCache();
}

function getScreenshot(tabId, url = null) {
  const entry = tabScreenshotCache.get(tabId);
  if (entry && entry.dataUrl) {
    return entry.dataUrl;
  }

  if (url) {
    for (const [, cachedEntry] of tabScreenshotCache.entries()) {
      if (cachedEntry.url === url && cachedEntry.dataUrl) {
        return cachedEntry.dataUrl;
      }
    }
  }

  return null;
}

function isInternalPage(url = '') {
  return url.startsWith('chrome://') ||
         url.startsWith('brave://') ||
         url.startsWith('helium://') ||
         url.startsWith('edge://') ||
         url.startsWith('vivaldi://') ||
         url.startsWith('about:');
}

function isRestrictedUrl(url = '') {
  return url.startsWith('chrome://') ||
         url.startsWith('chrome-extension://') ||
         url.startsWith('edge://') ||
         url.startsWith('about:') ||
         url.startsWith('devtools://');
}

// Track if switcher is currently visible
let switcherVisible = false;

// Screenshot capture system
let captureInProgress = false;
let pendingCaptureTimeout = null;

async function captureScreenshot(tabId, windowId) {
  if (captureInProgress || switcherVisible) return;
  captureInProgress = true;
  try {
    const [currentActiveTab] = await chrome.tabs.query({ active: true, windowId });
    if (!currentActiveTab || currentActiveTab.id !== tabId) return;

    const tab = await chrome.tabs.get(tabId);
    if (!tab || isRestrictedUrl(tab.url)) return;

    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
      format: 'jpeg',
      quality: 80
    });
    await setScreenshot(tabId, dataUrl, tab.url);
  } catch (error) {
    // Ignore errors for restricted pages
  } finally {
    captureInProgress = false;
  }
}

function scheduleCaptureScreenshot(tabId, windowId, delay = 500) {
  if (pendingCaptureTimeout) {
    clearTimeout(pendingCaptureTimeout);
  }
  pendingCaptureTimeout = setTimeout(() => {
    pendingCaptureTimeout = null;
    captureScreenshot(tabId, windowId);
  }, delay);
}

async function loadMRUOrder() {
  try {
    const stored = await chrome.storage.session.get(MRU_CACHE_KEY);
    const savedOrder = stored[MRU_CACHE_KEY];
    if (Array.isArray(savedOrder)) {
      mruTabOrder = savedOrder;
    }
  } catch (error) {
    console.warn('Failed to load MRU order', error);
  }
}

async function persistMRUOrder() {
  try {
    await chrome.storage.session.set({ [MRU_CACHE_KEY]: mruTabOrder });
  } catch (error) {
    console.warn('Failed to persist MRU order', error);
  }
}

// Sort tabs by MRU order
function sortTabsByMRU(tabs) {
  const tabMap = new Map(tabs.map(tab => [tab.id, tab]));
  const sortedTabs = [];
  const addedIds = new Set();
  
  for (const tabId of mruTabOrder) {
    if (tabMap.has(tabId)) {
      sortedTabs.push(tabMap.get(tabId));
      addedIds.add(tabId);
    }
  }
  
  for (const tab of tabs) {
    if (!addedIds.has(tab.id)) {
      sortedTabs.push(tab);
    }
  }
  
  return sortedTabs;
}

// Check if content script is loaded and inject if needed
async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { action: "ping" });
    return true;
  } catch (error) {
    // Content script not loaded, inject it
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ['content.js']
      });
      await new Promise(resolve => setTimeout(resolve, 50));
      return true;
    } catch (injectError) {
      console.error("Failed to inject content script:", injectError);
      return false;
    }
  }
}

// Toggle the tab switcher with direction
async function toggleTabSwitcher(direction = "forward") {
  try {
    await cacheInitPromise; // ensure screenshot cache restored before building UI

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab || !tab.id) {
      console.warn("No active tab found");
      return;
    }
    
    const isLoaded = await ensureContentScript(tab.id);
    if (!isLoaded) {
      console.error("Could not load content script");
      return;
    }
    
    // Get hideInternalPages setting
    const settings = await chrome.storage.sync.get(['tabSwitcherSettings']);
    const hideInternalPages = settings.tabSwitcherSettings?.hideInternalPages || false;
    
    const allTabs = await chrome.tabs.query({ currentWindow: true });
    const sortedTabs = sortTabsByMRU(allTabs);
    
    // Filter out internal pages if setting is enabled
    const filteredTabs = hideInternalPages
      ? sortedTabs.filter(tab => !isInternalPage(tab.url))
      : sortedTabs;
    
    // Optimization: Only send top 20 tabs to avoid massive payload with screenshots
    const tabsToSend = filteredTabs.slice(0, 20);
    
    // Attach cached screenshots to tabs
    const tabsWithScreenshots = tabsToSend.map(t => ({
      ...t,
      screenshot: getScreenshot(t.id, t.url) || null
    }));
    
    try {
      await chrome.tabs.sendMessage(tab.id, {
        action: "toggleSwitcher",
        tabs: tabsWithScreenshots,
        currentTabId: tab.id,
        direction: direction
      });
    } catch (messageError) {
      console.error("Could not send message to tab:", messageError);
    }
  } catch (error) {
    console.error("Error toggling tab switcher:", error);
  }
}

chrome.commands.onCommand.addListener(async (command) => {
  console.log('Command received:', command);
  if (command === 'toggle-tab-switcher') {
    toggleTabSwitcher("forward"); // Ctrl+Shift+Q opens switcher going forward
  } else if (command === 'search-mode') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;
    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'openDirectSearch' });
    } catch (e) {
      // Content script not loaded; inject and retry once
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js']
        });
        await chrome.tabs.sendMessage(tab.id, { action: 'openDirectSearch' });
      } catch (injectErr) {
        console.error('Failed to open direct search:', injectErr);
      }
    }
  } else if (command === 'bookmarks-mode') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;
    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'openDirectBookmarks' });
    } catch (e) {
      // Content script not loaded; inject and retry once
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js']
        });
        await chrome.tabs.sendMessage(tab.id, { action: 'openDirectBookmarks' });
      } catch (injectErr) {
        console.error('Failed to open direct bookmarks:', injectErr);
      }
    }
  }
});

// Listen for tab activation to maintain MRU order
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tabId = activeInfo.tabId;
  mruTabOrder = mruTabOrder.filter(id => id !== tabId);
  mruTabOrder.unshift(tabId);
  if (mruTabOrder.length > 100) {
    mruTabOrder = mruTabOrder.slice(0, 100);
  }
  persistMRUOrder();

  // Capture screenshot of newly active tab after a delay
  scheduleCaptureScreenshot(tabId, activeInfo.windowId, 800);
});

// Listen for tab removal to clean up MRU list and cache
chrome.tabs.onRemoved.addListener((tabId) => {
  mruTabOrder = mruTabOrder.filter(id => id !== tabId);
  persistMRUOrder();
  deleteScreenshot(tabId);
});

// Listen for tab updates (URL changes, page load completion)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Capture screenshot when page finishes loading and tab is active
  if (changeInfo.status === 'complete' && tab.active && tab.windowId !== undefined) {
    scheduleCaptureScreenshot(tabId, tab.windowId, 500);
  }
});

// Handle window focus changes
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    return;
  }
  chrome.tabs.query({ active: true, windowId: windowId }).then(tabs => {
    if (tabs.length > 0) {
      const tabId = tabs[0].id;
      mruTabOrder = mruTabOrder.filter(id => id !== tabId);
      mruTabOrder.unshift(tabId);
      persistMRUOrder();
    }
  });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "switchToTab") {
    chrome.tabs.update(request.tabId, { active: true })
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  } else if (request.action === "closeTab") {
    chrome.tabs.remove(request.tabId)
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  } else if (request.action === "openBookmark") {
    chrome.tabs.create({ url: request.url })
      .then((tab) => sendResponse({ success: true, tabId: tab.id }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  } else if (request.action === "switcherShown") {
    // Switcher is now visible - don't capture screenshots
    switcherVisible = true;
    sendResponse({ success: true });
  } else if (request.action === "getAllTabs") {
    // Get all tabs and current tab for direct search
    chrome.storage.sync.get(['tabSwitcherSettings'], (result) => {
      const settings = result.tabSwitcherSettings || {};
      const hideInternalPages = settings.hideInternalPages || false;
      
      chrome.tabs.query({}, (tabs) => {
        // Filter out internal pages if setting is enabled
        let filteredTabs = tabs;
        if (hideInternalPages) {
          filteredTabs = tabs.filter(tab => !isInternalPage(tab.url));
        }
        
        chrome.tabs.query({ active: true, currentWindow: true }, (currentTab) => {
          const currentTabId = currentTab.length > 0 ? currentTab[0].id : null;
          sendResponse({ 
            tabs: filteredTabs,
            currentTabId: currentTabId
          });
        });
      });
    });
    return true;
  } else if (request.action === "getAllBookmarks") {
    // Get all bookmarks tree
    chrome.bookmarks.getTree((bookmarkTree) => {
      const bookmarks = [];
      
      function flattenBookmarks(nodes, path = []) {
        for (const node of nodes) {
          if (node.url) {
            const folderPath = path.join('/') || 'Bookmarks';
            bookmarks.push({
              id: node.id,
              title: node.title || node.url,
              url: node.url,
              path: folderPath,
              pathArray: [...path]
            });
          }
          if (node.children) {
            // Only include folders that contain bookmarks
            const childPath = [...path, node.title || 'Folder'];
            flattenBookmarks(node.children, childPath);
          }
        }
      }
      
      flattenBookmarks(bookmarkTree);
      sendResponse({ bookmarks: bookmarks });
    });
    return true;
  } else if (request.action === "switcherHidden") {
    // Switcher is now hidden - can capture screenshots again
    switcherVisible = false;

    // Capture screenshot of the newly active tab after switcher is hidden
    if (sender.tab && sender.tab.id) {
      chrome.tabs.get(sender.tab.id).then(tab => {
        if (tab && tab.active) {
          scheduleCaptureScreenshot(sender.tab.id, tab.windowId, 500);
        }
      }).catch(() => {});
    }
    sendResponse({ success: true });
  }
});

// Open options page when extension icon is clicked
chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

// Open settings page on first install
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.runtime.openOptionsPage();
  }
});

// Initialize MRU list when extension loads
Promise.all([loadMRUOrder(), cacheInitPromise, chrome.tabs.query({})]).then(([_, __, tabs]) => {
  const allTabIds = new Set(tabs.map(t => t.id));
  let validMru = mruTabOrder.filter(id => allTabIds.has(id));
  
  const activeTabs = tabs.filter(t => t.active);
  const activeTabIds = new Set(activeTabs.map(t => t.id));

  if (validMru.length === 0) {
     validMru = [...activeTabIds, ...tabs.filter(t => !activeTabIds.has(t.id)).map(t => t.id)];
  } else {
     validMru = validMru.filter(id => !activeTabIds.has(id));
     validMru = [...activeTabIds, ...validMru];
     
     const knownIds = new Set(validMru);
     const unknownTabs = tabs.filter(t => !knownIds.has(t.id)).map(t => t.id);
     validMru = [...validMru, ...unknownTabs];
  }
  
  mruTabOrder = validMru;
  persistMRUOrder();
  
  // Capture screenshot of currently active tab in focused window
  const activeTab = tabs.find(t => t.active && t.windowId);
  if (activeTab) {
    scheduleCaptureScreenshot(activeTab.id, activeTab.windowId, 500);
  }
}).catch(error => {
  console.error('MRU initialization failed:', error);
});

