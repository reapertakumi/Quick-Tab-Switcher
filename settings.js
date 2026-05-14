document.addEventListener('DOMContentLoaded', () => {
    const sidebarItems = document.querySelectorAll('.sidebar-item');
    const sections = document.querySelectorAll('.section');
    
    const tabCountSelect = document.getElementById('tabCount');
    const previewToggle = document.getElementById('previewToggle');
    const scaleSlider = document.getElementById('scaleSlider');
    const scaleValue = document.getElementById('scaleValue');
    const hideInternalPagesToggle = document.getElementById('hideInternalPages');
    const themeSelect = document.getElementById('theme');
    const highlightColorSelect = document.getElementById('highlightColor');
    const tabTitleLayoutSelect = document.getElementById('tabTitleLayout');
    const tabSwitcherHotkeySpan = document.getElementById('tabSwitcherHotkey');
    const searchHotkeySelect = document.getElementById('searchHotkey');
    const directSearchToggle = document.getElementById('directSearch');
    const bookmarksHotkeySelect = document.getElementById('bookmarksHotkey');
    const directBookmarksToggle = document.getElementById('directBookmarks');
    const saveBtn = document.getElementById('saveBtn');
    const statusDiv = document.getElementById('status');

    // Sidebar navigation
    sidebarItems.forEach(item => {
        item.addEventListener('click', () => {
            const targetSection = item.dataset.section;
            
            // Update active states
            sidebarItems.forEach(si => si.classList.remove('active'));
            sections.forEach(section => section.classList.remove('active'));
            
            // Activate new section
            item.classList.add('active');
            document.getElementById(targetSection).classList.add('active');
        });
    });

    // Function to update hotkey display
    async function updateHotkeyDisplays() {
        try {
            const commands = await chrome.commands.getAll();
            
            commands.forEach(command => {
                if (command.name === 'toggle-tab-switcher' && command.shortcut) {
                    // Update tab switcher hotkey display
                    const tabSwitcherHotkey = document.getElementById('tabSwitcherHotkey');
                    if (tabSwitcherHotkey) {
                        tabSwitcherHotkey.textContent = command.shortcut;
                    }
                } else if (command.name === 'search-mode' && command.shortcut) {
                    // Update search hotkey display
                    const customOption = searchHotkeySelect.querySelector('option[value="custom"]');
                    if (customOption) {
                        customOption.textContent = `Custom (${command.shortcut})`;
                    }
                } else if (command.name === 'bookmarks-mode' && command.shortcut) {
                    // Update bookmarks hotkey display
                    const customOption = bookmarksHotkeySelect.querySelector('option[value="custom"]');
                    if (customOption) {
                        customOption.textContent = `Custom (${command.shortcut})`;
                    }
                }
            });
        } catch (error) {
            console.error('Error getting commands:', error);
        }
    }

    // Tab switcher hotkey click handler
    tabSwitcherHotkeySpan.addEventListener('click', () => {
        chrome.tabs.create({url: 'chrome://extensions/shortcuts'});
    });
    
    searchHotkeySelect.addEventListener('change', () => {
        if (searchHotkeySelect.value === 'custom') {
            chrome.tabs.create({url: 'chrome://extensions/shortcuts'});
            // Reset to default after opening shortcuts
            setTimeout(() => {
                searchHotkeySelect.value = currentSettings.searchHotkey || 'F2';
            }, 100);
        }
    });

    bookmarksHotkeySelect.addEventListener('change', () => {
        if (bookmarksHotkeySelect.value === 'custom') {
            chrome.tabs.create({url: 'chrome://extensions/shortcuts'});
            // Reset to default after opening shortcuts
            setTimeout(() => {
                bookmarksHotkeySelect.value = currentSettings.bookmarksHotkey || 'F4';
            }, 100);
        }
    });

    // Update hotkey displays when page loads
    updateHotkeyDisplays();

    // Apply accent color to sidebar active border
    function applyAccentColor(color) {
        document.documentElement.style.setProperty('--active-accent', color);
    }

    // Apply dark mode to main content
    function applyTheme(theme) {
        const effectiveTheme = theme === 'system'
            ? (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
            : theme;
        document.body.classList.toggle('dark-mode', effectiveTheme === 'dark');
    }

    // Load settings
    chrome.storage.sync.get(['tabSwitcherSettings'], (result) => {
        console.log('[LOAD DEBUG] Loading settings from storage');
        const settings = result.tabSwitcherSettings;
        console.log('[LOAD DEBUG] Loaded settings:', settings);
        if (settings) {
            // Load tab count
            if (settings.maxTabs) {
                tabCountSelect.value = settings.maxTabs;
            }
            
            // Load preview toggle
            if (settings.showPreviews !== undefined) {
                previewToggle.checked = settings.showPreviews;
            }
            
            // Load scale
            if (settings.previewScale) {
                scaleSlider.value = settings.previewScale;
                scaleValue.textContent = settings.previewScale + '%';
            }
            
            // Load hide internal pages
            if (settings.hideInternalPages !== undefined) {
                hideInternalPagesToggle.checked = settings.hideInternalPages;
            }
            
            // Load theme
            if (settings.theme) {
                themeSelect.value = settings.theme;
            }
            applyTheme(themeSelect.value);
            
            // Load highlight color
            if (settings.highlightColor) {
                highlightColorSelect.value = settings.highlightColor;
            }
            applyAccentColor(highlightColorSelect.value);
            
            // Load tab title layout
            if (settings.tabTitleLayout !== undefined) {
                tabTitleLayoutSelect.value = settings.tabTitleLayout || 'header';
                console.log('[LOAD DEBUG] Tab title layout loaded:', tabTitleLayoutSelect.value);
            }
            
            // Load tab switcher hotkey
            if (settings.tabSwitcherHotkey) {
                tabSwitcherHotkeySpan.textContent = settings.tabSwitcherHotkey;
            } else {
                tabSwitcherHotkeySpan.textContent = 'Ctrl+Shift+Q';
            }
            
            // Load search hotkey
            if (settings.searchHotkey) {
                searchHotkeySelect.value = settings.searchHotkey;
                console.log('[LOAD DEBUG] Search hotkey loaded:', searchHotkeySelect.value);
            } else {
                searchHotkeySelect.value = 'F2';
            }
            
            // Load direct search toggle
            if (settings.directSearch !== undefined) {
                directSearchToggle.checked = settings.directSearch;
                console.log('[LOAD DEBUG] Direct search loaded:', directSearchToggle.checked);
            }
            
            // Load bookmarks hotkey
            if (settings.bookmarksHotkey) {
                bookmarksHotkeySelect.value = settings.bookmarksHotkey;
                console.log('[LOAD DEBUG] Bookmarks hotkey loaded:', bookmarksHotkeySelect.value);
            } else {
                bookmarksHotkeySelect.value = 'F4';
            }
            
            // Load direct bookmarks toggle
            if (settings.directBookmarks !== undefined) {
                directBookmarksToggle.checked = settings.directBookmarks;
                console.log('[LOAD DEBUG] Direct bookmarks loaded:', directBookmarksToggle.checked);
            }
        }
    });

    // Scale slider update
    scaleSlider.addEventListener('input', () => {
        scaleValue.textContent = scaleSlider.value + '%';
    });

    // Live preview: theme change
    themeSelect.addEventListener('change', () => {
        applyTheme(themeSelect.value);
    });

    // Live preview: accent color change
    highlightColorSelect.addEventListener('change', () => {
        applyAccentColor(highlightColorSelect.value);
    });

    // Save settings
    saveBtn.addEventListener('click', () => {
        console.log('[SAVE DEBUG] Save button clicked');
        const settings = {
            maxTabs: tabCountSelect.value,
            showPreviews: previewToggle.checked,
            previewScale: parseInt(scaleSlider.value),
            hideInternalPages: hideInternalPagesToggle.checked,
            theme: themeSelect.value,
            highlightColor: highlightColorSelect.value,
            tabTitleLayout: tabTitleLayoutSelect.value,
            tabSwitcherHotkey: tabSwitcherHotkeySpan.textContent,
            searchHotkey: searchHotkeySelect.value,
            directSearch: directSearchToggle.checked,
            bookmarksHotkey: bookmarksHotkeySelect.value,
            directBookmarks: directBookmarksToggle.checked
        };
        console.log('[SAVE DEBUG] Settings to save:', settings);

        chrome.storage.sync.set({ tabSwitcherSettings: settings }, () => {
            console.log('[SAVE DEBUG] Settings saved successfully');
            // Show success message
            statusDiv.textContent = 'Settings saved successfully!';
            statusDiv.className = 'status success';
            statusDiv.style.display = 'block';

            // Hide message after 3 seconds
            setTimeout(() => {
                statusDiv.style.display = 'none';
            }, 3000);
        });
    });
});
