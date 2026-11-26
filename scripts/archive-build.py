"""Archive the built app and its matching source without local databases, credentials or weights."""
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
from uuid import uuid4
from zipfile import ZipFile, ZIP_DEFLATED

root=Path(__file__).resolve().parents[1]
out=root/".local"/"build-history"
out.mkdir(parents=True,exist_ok=True)
name="infrared-"+datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")+"-"+uuid4().hex[:8]
directory=out/name
directory.mkdir()
staging=directory/(name+".partial")
files=set()
for folder in ("apps","packages","config","scripts","infra/predictive","docs","tests","dist/dashboard"):
    for file in (root/folder).rglob("*"):
        if file.is_file() and not file.is_symlink() and "__pycache__" not in file.parts and file.suffix not in (".pyc",".log"):
            files.add(file.relative_to(root))
for filename in ("package.json","package-lock.json","pnpm-lock.yaml","pnpm-workspace.yaml","tsconfig.json","vite.config.ts","vitest.config.ts","playwright.config.ts","README.md",".env.example"):
    files.add(Path(filename))
sdk=root/"dist/sdk"
artifact=json.loads((sdk/"artifact.json").read_text())
for filename in ("artifact.json","bootstrap.js",artifact["file"]):
    files.add(Path("dist/sdk")/Path(filename).name)
if not (root/"dist/dashboard/index.html").is_file():
    raise RuntimeError("Run the application build before archiving")
digests={}
with ZipFile(staging,"x",compression=ZIP_DEFLATED,compresslevel=6) as archive:
    for relative in sorted(files):
        contents=(root/relative).read_bytes()
        digests[relative.as_posix()]=hashlib.sha256(contents).hexdigest()
        archive.writestr(relative.as_posix(),contents)
    archive.writestr("BUILD-MANIFEST.json",json.dumps({"build":name,"files":digests},indent=2))
with ZipFile(staging) as archive:
    if archive.testzip() is not None:
        raise RuntimeError("Build ZIP verification failed")
final=staging.with_suffix(".zip")
os.rename(staging,final)
with final.open("rb") as archive_file:
    checksum=hashlib.file_digest(archive_file,"sha256").hexdigest()
(directory/"SHA256.txt").write_text(checksum+"  "+final.name+"\n")
print(final)
