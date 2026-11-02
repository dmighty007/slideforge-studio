import json,collections,csv,pathlib,sys,zipfile
out=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else 'docs/audits/pptx-import-2026-11-01')
data=json.loads((out/'results.json').read_text())
picture_reasons=collections.Counter()
for deck in data:
 try:
  with zipfile.ZipFile(pathlib.Path.home()/'Documents/PPTx'/deck['file']) as archive:
   for slide in deck.get('slides',[]):
    for issue in slide.get('issues',[]):
     if issue['kind'] != 'dropped-pictures': continue
     for item in issue['items']:
      part=item['part']
      if part not in archive.namelist(): reason='unresolved or missing media part'
      else:
       item['sourceBytes']=archive.getinfo(part).file_size
       reason='empty source media (not new import loss)' if item['sourceBytes']==0 else 'unsupported format' if part.rsplit('.',1)[-1].lower() not in {'png','jpg','jpeg','gif','svg','webp','bmp'} else 'nonempty media rejected by browser decoder'
      item['reason']=reason
      picture_reasons[reason]+=1
 except (OSError,zipfile.BadZipFile): pass
counts=collections.Counter();decks=collections.defaultdict(set);rows=[];failures=[]
for d in data:
 if d.get('error'):failures.append((d['file'],'deck',d['error']))
 if d.get('aspectRatioChanged'):
  counts['aspect-ratio-adjusted']+=1;decks['aspect-ratio-adjusted'].add(d['file']);rows.append([d['file'],'all','aspect-ratio-adjusted',f"Source {d['width']} x {d['height']} pixels; nearest preset selected"])
 for s in d.get('slides',[]):
  if s.get('error'):failures.append((d['file'],s['slide'],s['error']));rows.append([d['file'],s['slide'],'import-error',s['error']])
  for i in s.get('issues',[]):
   counts[i['kind']]+=1;decks[i['kind']].add(d['file']);rows.append([d['file'],s['slide'],i['kind'],json.dumps({k:v for k,v in i.items() if k!='kind'},ensure_ascii=False)])
with (out/'discrepancies.csv').open('w') as f:
 writer=csv.writer(f);writer.writerow(['file_relative_to_Documents_PPTx','slide_1_based','finding','evidence']);writer.writerows(rows)
lines=['# PowerPoint import audit — '+('2 November 2026' if '2026-11-02' in str(out) else '1 November 2026'),'',f"Source: `~/Documents/PPTx` (recursive). Audited **{len(data)} decks / {sum(d.get('sourceSlides',0) for d in data):,} slides** using the working-tree version of `frontend/js/export/importPptx.js`.",'',f"Deck-level failures: **{sum(bool(d.get('error')) for d in data)}**. Slide-level failures: **{sum(bool(s.get('error')) for d in data for s in d.get('slides',[]))}**.",'','## Findings','','Counts below are affected slide records, except aspect-ratio adjustments, which count decks. A slide can have multiple findings.','','| Finding | Affected records | Decks |','|---|---:|---:|']
for kind,n in counts.most_common():lines.append(f'| {kind} | {n} | {len(decks[kind])} |')
lines+=['','Dropped picture instances by cause: '+', '.join(f'{reason}: **{n}**' for reason,n in picture_reasons.items())+'. Empty source assets are source-file problems, not demonstrated importer regressions.','','## Interpretation','','- `dropped-pictures`: the actual picture importer returned no element. Evidence names the shape and media part. Unsupported EMF/WMF, unresolved relationships, empty files, and browser decoding failures can cause this.','- `background-picture-dropped`: the background importer returned no image.','- `smartart-not-imported` / `embedded-object-not-imported`: source structures are present and the importer has no matching import branch. Any separate fallback picture may still be visible.','- `video-playback-lost` / `audio-playback-lost`: embedded video references outnumber imported video elements, or source audio references exist. A poster picture may remain. `linked-video-outside-file` identifies external video references that cannot be imported from the package.','- `transition-lost`: a source transition effect is present but `_pptxTransition` maps it to `none`; transitions with only timing or sound metadata are excluded.','- `motion-path-not-imported`: source motion animation exists; motion paths are unsupported.','- `aspect-ratio-adjusted`: the importer chooses the closest of 4:3, 16:9, or 16:10. Content scales uniformly into that preset; custom source dimensions are not retained.','- **Review candidates**, not confirmed visual defects: `text-not-found-in-import` compares normalized source paragraph text against imported text/shape/table content. Bullet prefixes, fields and paragraph boundaries can cause false positives. `inherited-artwork-not-imported` counts non-placeholder objects on the referenced layout/master; the check respects source visibility settings and flags a layer only when no imported element is marked as coming from it. Partial omissions within a layer are not detected.','','## Examples','']
for kind in counts:
 if kind in ('text-not-found-in-import','inherited-artwork-not-imported'):continue
 examples=[r for r in rows if r[2]==kind][:3]
 for f,slide,_,detail in examples:lines.append(f'- **{kind}** — `{f}`, slide {slide}: {detail[:600]}')
lines+=['','## Evidence and scope','','- [discrepancies.csv](discrepancies.csv): every finding, relative filename, 1-based slide number, and evidence.','- [results.json](results.json): per-deck dimensions, slide counts, imported element counts/types, errors and findings.','- Imports ran in headless Chromium through the real package/design/slide/picture/background import functions, with XML and media read from the original ZIPs. Picture decoding was exercised. Assets used a stub upload URL; no projects or assets were written to the application database. Imported slide models were inspected in memory, then discarded.','- This is a structural import audit, **not a pixel-by-pixel visual comparison**. No PowerPoint/LibreOffice reference renderer was available. Fonts, line wrapping, exact positioning, fills, chart styling, animation fidelity, and editor save/reload behavior are not certified. A deck without recorded findings is not guaranteed visually identical.','- Existing working-tree changes were retained; the importer itself was not modified by this audit.','','## Reproduce','','From the repository root, run `python3 tools/pptx-audit-server.py ~/Documents/PPTx`, then in another terminal run `node tools/audit-pptx-import.cjs OUTPUT_DIRECTORY`. The server binds only to `127.0.0.1:8767`. Playwright and its Chromium browser must be installed; `PLAYWRIGHT_MODULE` can point to an existing Playwright module. Run `python3 tools/summarize-pptx-audit.py OUTPUT_DIRECTORY` to regenerate the report and CSV. Stop the server after the audit.','']
if failures:lines+=['## Import errors','']+[f'- `{f}`, slide {s}: {e}' for f,s,e in failures]
(out/'README.md').write_text('\n'.join(lines))
print(len(data),sum(d.get('sourceSlides',0) for d in data),counts, 'failures',len(failures))
