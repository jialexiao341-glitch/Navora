"""Import the pinned Doro animation pack; run explicitly when updating assets."""
import concurrent.futures
import hashlib
import json
import re
import urllib.request
from pathlib import Path

REV = 'e56528ff321fed127ed2e123efc34b9c9a1b4b26'
REPO = 'zhu1090093659/dsh-pet'
DEST = Path(__file__).resolve().parents[1] / 'channel/web/static/vendor/doro'
TRACKS = ('idle','move','work','work-success','work-fail','sleep','wash','cola','orange','tongue','struggle')

def fetch(url):
    for attempt in range(5):
        try:
            with urllib.request.urlopen(url, timeout=30) as response:
                return response.read()
        except Exception:
            if attempt == 4:
                raise

def listing(track):
    cache = DEST / f'.listing-{track}.json'
    if cache.exists():
        return json.loads(cache.read_text())
    text = fetch(f'https://github.com/{REPO}/tree/{REV}/assets/doro/thumb/{track}').decode()
    for data in re.findall(r'<script[^>]*type="application/json"[^>]*>(.*?)</script>',text):
        payload = json.loads(data).get('payload', {}).get('codeViewTreeRoute')
        if payload:
            items = payload['tree']['items']
            if len(items) != payload['tree']['totalCount']:
                raise ValueError('Truncated directory: '+track)
            paths = [i['path'] for i in items if i['name'].endswith('.webp')]
            cache.write_text(json.dumps(paths))
            return paths
    raise ValueError('Missing directory listing: '+track)

def download(source):
    target = DEST / source
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        target.write_bytes(fetch(f'https://raw.githubusercontent.com/{REPO}/{REV}/{source}'))
    data = target.read_bytes()
    return source, hashlib.sha256(data).hexdigest()

if __name__ == '__main__':
    DEST.mkdir(parents=True,exist_ok=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
        tracks = dict(zip(TRACKS,pool.map(listing,TRACKS)))
        tracks = {track:sorted(paths,key=lambda p:int(re.search(r'-(\d+)_',p).group(1))) for track,paths in tracks.items()}
        sources = [p for frames in tracks.values() for p in frames]
        hashes = dict(pool.map(download,sources+['assets/doro/pet.json','LICENSE','THIRD_PARTY_NOTICES.md']))
    manifest = {'source':REPO,'revision':REV,'frameMs':42,'tracks':tracks,'sha256':hashes}
    (DEST/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
    for cache in DEST.glob('.listing-*.json'):
        cache.unlink()
    print(f'Imported {len(sources)} frames in {len(tracks)} tracks.')
