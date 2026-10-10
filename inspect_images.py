import os
import subprocess
from PIL import Image

for fname in sorted(os.listdir('upload')):
    if fname.endswith(('.png', '.jpg')):
        fpath = os.path.join('upload', fname)
        try:
            im = Image.open(fpath)
            print(f"=== {fname} === size={im.size}, mode={im.mode}")
        except Exception as e:
            print(f"=== {fname} === error {e}")
