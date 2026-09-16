import os

MAX_ALLOWED = 25 * 1024 * 1024
root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

all_files = []
for dirpath, _, filenames in os.walk(root_dir):
    if '.git' in dirpath:
        continue
    for fname in filenames:
        fpath = os.path.join(dirpath, fname)
        size = os.path.getsize(fpath)
        all_files.append((fpath, size))

all_files.sort(key=lambda x: x[1], reverse=True)

print(f"Total files: {len(all_files)}")
total_size = sum(s for _, s in all_files)
print(f"Total size: {total_size / (1024*1024):.2f} MB")
print("\nTop 10 Largest Files:")
over_limit = 0
for path, size in all_files[:10]:
    rel = os.path.relpath(path, root_dir)
    status = "OK" if size <= MAX_ALLOWED else "EXCEEDS LIMIT!"
    if size > MAX_ALLOWED:
        over_limit += 1
    print(f" - {size / (1024*1024):6.2f} MB | {status} | {rel}")

if over_limit == 0:
    print("\n[SUCCESS] ALL files are strictly under the 25 MB limit! Ready for EdgeOne Pages.")
else:
    print(f"\n[ERROR] {over_limit} files exceed the 25 MB limit!")
