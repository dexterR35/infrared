"""Install the optional offline models into this Infrared workspace at pinned revisions."""
from pathlib import Path
from huggingface_hub import snapshot_download

root=Path(__file__).resolve().parents[3]/".local"/"research-models"
for name,folder,revision in (
    ("sentence-transformers/all-MiniLM-L6-v2","copy","1110a243fdf4706b3f48f1d95db1a4f5529b4d41"),
    ("google/siglip-base-patch16-224","vision","7fd15f0689c79d79e38b1c2e2e2370a7bf2761ed"),
):
    snapshot_download(name,revision=revision,local_dir=root/folder,
                      allow_patterns=["*.json","*.txt","*.model","model.safetensors","1_Pooling/*","README.md","LICENSE*"])
