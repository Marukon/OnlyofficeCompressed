import re
import os

with open('v9.3.0.24-1/sdkjs/common/AllFonts.js', 'r', encoding='utf-8') as f:
    content = f.read()

m = re.search(r'window\["__fonts_files"\]\s*=\s*\[(.*?)\];', content, re.DOTALL)
if m:
    items = re.findall(r'"([^"]+)"', m.group(1))
    print(f"Total font files listed in AllFonts.js: {len(items)}")
    print("All font IDs:", items)
else:
    print("Could not find __fonts_files")
