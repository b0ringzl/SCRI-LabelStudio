"""Install the weight-free registration worker in this project's own venv."""
from pathlib import Path
import os
import subprocess
import sys
import venv

ROOT=Path(__file__).resolve().parents[1]
environment=(ROOT/'.venv-registration').resolve()
if environment.parent!=ROOT.resolve():raise SystemExit('Invalid project environment path')
python=environment/('Scripts/python.exe' if os.name=='nt' else 'bin/python')
if not python.is_file():venv.EnvBuilder(with_pip=True).create(environment)
subprocess.run([str(python),'-m','pip','install','-r',str(ROOT/'scripts'/'requirements-registration.txt')],check=True)
subprocess.run([str(python),str(ROOT/'scripts'/'registration_worker.py'),'--check'],check=True)
print('Ready: '+str(python))
