"""Start a localhost-only desktop-configured app with a fresh temporary database."""
import os
import subprocess
import sys
import tempfile

env = {**os.environ, 'DJANGO_SETTINGS_MODULE': 'slideforge.desktop.settings',
       'SLIDEFORGE_DATA_DIR': tempfile.mkdtemp(prefix='sf-audit-'), 'SLIDEFORGE_DEBUG': '1'}
print('Temporary data:', env['SLIDEFORGE_DATA_DIR'], flush=True)
subprocess.run([sys.executable, 'backend/manage.py', 'migrate', '--noinput'], env=env, check=True)
server = subprocess.Popen([sys.executable, 'backend/manage.py', 'runserver',
                           '127.0.0.1:' + env.get('AUDIT_PORT', '8076'), '--noreload'], env=env)
try:
    server.wait()
except KeyboardInterrupt:
    pass
finally:
    if server.poll() is None:
        server.terminate()
        server.wait(timeout=10)
