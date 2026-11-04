"""Prepare temporary local-file artifacts for offline-readme.cjs."""
from pathlib import Path
import zipfile
from markdown_it import MarkdownIt
root = Path.cwd()
audit = Path(__file__).parent
with zipfile.ZipFile(audit / 'evidence/demonstration.zip') as archive:
    archive.extractall('/tmp/sf-release-offline')
rendered = MarkdownIt('commonmark', {'html': True}).enable('table').render((root / 'README.md').read_text())
css = '''body{margin:0;background:#fff;color:#1f2328;font:16px/1.5 Arial,sans-serif}article{max-width:830px;margin:32px auto;padding:32px;border:1px solid #d1d9e0;border-radius:8px}img{max-width:100%;height:auto}h1,h2{border-bottom:1px solid #ddd;padding-bottom:8px}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:8px}pre{background:#f6f8fa;padding:16px;overflow:auto}a{color:#0969da}summary{cursor:pointer}'''
Path('/tmp/sf-release-readme.html').write_text('<!doctype html><html><head><meta charset="utf-8"><base href="' + root.as_uri() + '/"><style>' + css + '</style></head><body><article>' + rendered + '</article></body></html>')
