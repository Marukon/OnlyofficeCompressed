import re

with open('v9.3.0.24-1/sdkjs/common/AllFonts.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Extract font names from __fonts_infos array
m = re.search(r'window\["__fonts_infos"\]\s*=\s*\[(.*?)\];', content, re.DOTALL)
if m:
    names = re.findall(r'\["([^"]+)"', m.group(1))
    print(f"Total font families: {len(names)}\n")
    for i, name in enumerate(names):
        print(f"  {i+1:3d}. {name}")
