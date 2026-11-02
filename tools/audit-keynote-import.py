"""Run the real Keynote converter and retain per-slide skipped-content evidence."""
import collections
import hashlib
import io
import subprocess
import tempfile
import json
import pathlib
import sys
import traceback
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'backend'))
from slideforge.bridge.keynote.iwa import open_keynote
from slideforge.bridge.keynote.convert import _Converter
out=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else 'docs/audits/keynote-import-2026-11-02')
out.mkdir(parents=True,exist_ok=True)
class AuditConverter(_Converter):
 def __init__(self,pkg):
  super().__init__(pkg);self.evidence=[];self.active=None
 def skip(self,what,count=1):
  super().skip(what,count)
  self.evidence.append({'slide':self.active,'kind':what,'count':count})
 def _slide(self,slide,**kw):
  self.active=(self.active or 0)+1
  effect=slide.transition.attributes.animationAttributes.effect
  made=super()._slide(slide,**kw)
  # Lost only when the converter passes nothing on: a transition missing from the slide, an "In" build whose
  # object got no entrance (movie start/stop builds are clicking the movie; outs and actions are counted in skipped).
  if effect and effect!='none' and not made.get('transition'): self.evidence.append({'slide':self.active,'kind':'transition discarded without skipped warning','count':1,'effect':effect})
  lost=0
  for ref in slide.builds:
   b=self.pkg.message(ref,'KN.BuildArchive');a=b.attributes.animationAttributes if b is not None else None
   if a is None or a.animation_type!='In' or a.effect in ('apple:movie-start','apple:movie-stop','apple:audio-start','apple:audio-stop'):continue
   lost+=1
  built=sum(1 for e in made['elements'] if e.get('build'))
  if lost>built: self.evidence.append({'slide':self.active,'kind':'build animations discarded without skipped warning','count':lost-built})
  return made
results=[]
for path in sorted(pathlib.Path.home().joinpath('Downloads').rglob('*')):
 if path.suffix.lower()!='.key':continue
 result={'file':str(path),'bytes':path.stat().st_size}
 try:
  data=path.read_bytes();result['sha256']=hashlib.sha256(data).hexdigest();pkg=open_keynote(data);converter=AuditConverter(pkg);deck=converter.convert()
  payload=deck.as_json();media=[]
  for key,asset in deck.media.items():
   record={'key':key,'name':asset.name,'mime':asset.mime,'bytes':len(asset.data)}
   try:
    if asset.mime.startswith('image/'):
     from PIL import Image
     with Image.open(io.BytesIO(asset.data)) as image: record['dimensions']=list(image.size);image.verify()
    elif asset.mime.startswith('video/'):
     with tempfile.NamedTemporaryFile(suffix=pathlib.Path(asset.name).suffix) as movie:
      movie.write(asset.data);movie.flush()
      probe=subprocess.run(['ffprobe','-v','error','-show_entries','stream=codec_name,codec_type,width,height','-of','json',movie.name],capture_output=True,text=True,timeout=30)
      if probe.returncode: raise ValueError(probe.stderr)
      record['streams']=json.loads(probe.stdout).get('streams',[])
    record['validation']='ok'
   except Exception as exc: record['validationError']=str(exc)
   media.append(record)
  for slide in payload['slides']:
   for el in slide['elements']:
    if 'media' in el:
     asset=deck.media[el['media']];el.update(src='audit://'+el['media'],contentType=asset.mime)
   if 'media' in slide.get('background',{}):slide['background']['src']='audit://'+slide['background']['media']
  result.update(deck=payload,media=media,findings=converter.evidence,objectTypes=dict(collections.Counter(o.name or str(o.type) for o in pkg.objects.values())))
  print(path.name,len(deck.slides),deck.skipped,flush=True)
 except Exception as exc:
  result.update(error=str(exc),traceback=traceback.format_exc());print(path.name,'ERROR',exc,flush=True)
 results.append(result)
(out/'results.json').write_text(json.dumps(results,indent=2))
