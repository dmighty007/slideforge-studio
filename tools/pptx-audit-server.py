import http.server,json,zipfile,pathlib,urllib.parse,sys
root=pathlib.Path(sys.argv[1]).expanduser().resolve() if len(sys.argv)>1 else pathlib.Path.home()/'Documents/PPTx'
files=sorted(p for p in root.rglob('*') if p.suffix.lower()=='.pptx')
class H(http.server.BaseHTTPRequestHandler):
 def log_message(self,*a): pass
 def do_GET(self):
  q=urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
  try:
   if self.path=='/': data=b'<html></html>'
   elif self.path=='/files': data=json.dumps([str(p.relative_to(root)) for p in files]).encode()
   else:
    with zipfile.ZipFile(files[int(q['i'][0])]) as z:
     if 'part' in q: data=z.read(q['part'][0])
     else: data=json.dumps({'names':z.namelist(),'xml':{n:z.read(n).decode('utf-8-sig') for n in z.namelist() if n.endswith(('.xml','.rels'))}}).encode()
   self.send_response(200);self.end_headers();self.wfile.write(data)
  except Exception as e:
   self.send_response(500);self.end_headers();self.wfile.write(str(e).encode())
http.server.ThreadingHTTPServer(('127.0.0.1',8767),H).serve_forever()
