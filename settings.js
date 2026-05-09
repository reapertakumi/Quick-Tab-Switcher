document.addEventListener('DOMContentLoaded', function() {
    const tabCountSelect = document.getElementById('tabCount');
    const previewToggle = document.getElementById('previewToggle');
    const highlightColorSelect = document.getElementById('highlightColor');
    const themeSelect = document.getElementById('theme');
    const saveBtn = document.getElementById('saveBtn');
    const status = document.getElementById('status');
    const hotkeyDisplay = document.getElementById('hotkeyDisplay');
    
    // Hotkey click handler
    hotkeyDisplay.addEventListener('click', function(e) {
        e.preventDefault();
        chrome.tabs.create({url: 'chrome://extensions/shortcuts'});
    });

    // Load current settings
    chrome.storage.sync.get(['maxTabs', 'previewEnabled', 'highlightColor', 'theme'], function(result) {
        if (result.maxTabs) {
            tabCountSelect.value = result.maxTabs;
        } else {
            tabCountSelect.value = '12'; // Default to 12 tabs
        }
        if (result.previewEnabled !== undefined) {
            previewToggle.checked = result.previewEnabled;
        }
        if (result.highlightColor) {
            highlightColorSelect.value = result.highlightColor;
        }
        if (result.theme) {
            themeSelect.value = result.theme;
        }
    });

    // Save settings
    saveBtn.addEventListener('click', function() {
        const maxTabs = tabCountSelect.value;
        const previewEnabled = previewToggle.checked;
        const highlightColor = highlightColorSelect.value;
        const theme = themeSelect.value;
        
        chrome.storage.sync.set({
            maxTabs: maxTabs,
            previewEnabled: previewEnabled,
            highlightColor: highlightColor,
            theme: theme
        }, function() {
            // Show success message
            status.style.display = 'block';
            status.className = 'status success';
            
            // Hide message after 2 seconds
            setTimeout(function() {
                status.style.display = 'none';
            }, 2000);
            
            // Notify all content scripts about theme change
            chrome.tabs.query({}, function(tabs) {
                tabs.forEach(tab => {
                    chrome.tabs.sendMessage(tab.id, {
                        action: 'themeChanged',
                        theme: theme
                    }, function(response) {
                        // Ignore errors for tabs that don't have content script
                        if (chrome.runtime.lastError) {
                            // Silently fail
                        }
                    });
                });
            });
        });
    });
});
