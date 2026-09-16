import glob
import re
import os

# 1. Update document_editor_service_worker.js
sw_content = """/**
 * ONLYOFFICE Service Worker Disabler / Cleaner
 * Automatically unregisters existing service workers and cleans caches.
 */

self.addEventListener('install', function (event) {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) { return caches.delete(k); }));
    }).then(function () {
      return self.registration.unregister();
    })
  );
});
"""

with open('v9.3.0.24-1/document_editor_service_worker.js', 'w', encoding='utf-8') as f:
    f.write(sw_content)
print('Updated document_editor_service_worker.js')

# 2. In all HTML files, replace service worker registration with unregistration
files = glob.glob('v9.3.0.24-1/**/*.html', recursive=True)
modified = 0

old_pattern = re.compile(r'\+function registerServiceWorker\(\)\{[\s\S]+?\}\(\);')
replacement = '+function registerServiceWorker(){if("serviceWorker" in navigator){navigator.serviceWorker.getRegistrations().then(function(regs){for(var i=0;i<regs.length;i++){regs[i].unregister();}}).catch(function(){})}}();'

for f in files:
    with open(f, 'r', encoding='utf-8', errors='ignore') as fp:
        c = fp.read()
    if 'registerServiceWorker' in c:
        new_c = old_pattern.sub(replacement, c)
        if new_c != c:
            with open(f, 'w', encoding='utf-8') as fp:
                fp.write(new_c)
            modified += 1
            print(f'Replaced in {f}')

# Also handle cache-scripts.html and forms/index.html if they have inline registration
for path in ['v9.3.0.24-1/web-apps/apps/api/documents/cache-scripts.html', 'v9.3.0.24-1/web-apps/apps/documenteditor/forms/index.html']:
    if os.path.exists(path):
        with open(path, 'r', encoding='utf-8', errors='ignore') as fp:
            c = fp.read()
        if 'navigator.serviceWorker.register' in c:
            c = c.replace('navigator.serviceWorker.register(serviceWorkerPath)', 'Promise.reject("disabled")')
            with open(path, 'w', encoding='utf-8') as fp:
                fp.write(c)
            print(f'Neutered registration in {path}')

print(f'Done. Modified {modified} files.')
