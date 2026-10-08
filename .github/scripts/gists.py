"""Publishes each article's gists/ folder as GitHub Gists and points the article at them.

For every articles/*/gists/manifest.json entry, creates the gist (or updates it if it
already exists), then replaces the article's link to the file in this repo with the
gist URL. Needs GIST_TOKEN: a token with the "gist" scope.
"""
import glob
import json
import os
import urllib.request

TOKEN = os.environ.get('GIST_TOKEN')
if not TOKEN:
    raise SystemExit('Add a GIST_TOKEN secret (a token with the "gist" scope) first.')

REPO = 'https://github.com/Ernesto-tha-great/Ernesto-tha-great/blob/main'


def api(method, url, payload):
    req = urllib.request.Request(url, method=method, data=json.dumps(payload).encode(), headers={
        'Authorization': f'Bearer {TOKEN}',
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
    })
    with urllib.request.urlopen(req) as res:
        return json.load(res)


for manifest_path in sorted(glob.glob('articles/*/gists/manifest.json')):
    folder = os.path.dirname(manifest_path)
    article_path = os.path.join(os.path.dirname(folder), 'article.md')
    manifest = json.load(open(manifest_path))
    article = open(article_path).read()

    for entry in manifest:
        content = open(os.path.join(folder, entry['file'])).read()
        payload = {'description': entry['description'], 'files': {entry['name']: {'content': content}}}
        if entry.get('gist'):
            gist = api('PATCH', f"https://api.github.com/gists/{entry['gist']}", payload)
        else:
            gist = api('POST', 'https://api.github.com/gists', {**payload, 'public': True})
        entry['gist'], entry['url'] = gist['id'], gist['html_url']
        article = article.replace(f"{REPO}/{folder}/{entry['file']}", gist['html_url'])
        print(f"{entry['file']} -> {gist['html_url']}")

    open(article_path, 'w').write(article)
    with open(manifest_path, 'w') as f:
        json.dump(manifest, f, indent=2)
        f.write('\n')
