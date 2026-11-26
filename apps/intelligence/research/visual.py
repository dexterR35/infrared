from functools import lru_cache
import io
import os
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import uniform_filter, gaussian_filter

LABELS=("a call to action button","a product or service card","a navigation menu",
        "a pricing table","a promotional banner","a form","editorial content")


def model_path(variable,folder):
    configured=os.environ.get(variable)
    if configured:
        return Path(configured).resolve(strict=True)
    installed=Path(__file__).resolve().parents[3]/".local"/"research-models"/folder
    return installed if (installed/"model.safetensors").is_file() else None


@lru_cache(maxsize=1)
def load_vision(path):
    from transformers import AutoModel,AutoProcessor
    model=AutoModel.from_pretrained(path,local_files_only=True,use_safetensors=True).eval()
    if model.config.model_type not in ("clip","siglip"):
        raise ValueError("Expected local CLIP or SigLIP weights")
    return model,AutoProcessor.from_pretrained(path,local_files_only=True)


@lru_cache(maxsize=1)
def load_copy(path):
    from sentence_transformers import SentenceTransformer
    return SentenceTransformer(str(path),device="cpu",local_files_only=True)


def visual_analysis(png):
    with Image.open(io.BytesIO(png)) as original:
        if original.format!="PNG" or original.width*original.height>40_000_000:
            raise ValueError("Invalid reference image")
        image=original.convert("RGB")
    reduced=image.copy()
    reduced.thumbnail((192,192))
    grey=np.asarray(reduced.convert("L"),dtype=float)
    signal=np.fft.fft2(grey)
    amplitude=np.log(np.maximum(np.abs(signal),1e-8))
    residual=amplitude-uniform_filter(amplitude,3,mode="wrap")
    saliency=gaussian_filter(np.abs(np.fft.ifft2(np.exp(residual+1j*np.angle(signal))))**2,2)
    bands=np.array([v.sum() for v in np.array_split(saliency,4,axis=0)])
    result={"predicted_saliency_quarters":(bands/bands.sum()).tolist() if grey.std()>0 and bands.sum()>0 else None}
    vision=model_path("INFRARED_VISION_MODEL","vision")
    if vision:
        import torch
        model,processor=load_vision(vision)
        batch=processor(text=list(LABELS),images=image,padding="max_length",max_length=model.config.text_config.max_position_embeddings,truncation=True,return_tensors="pt")
        with torch.inference_mode():
            raw=model(**batch).logits_per_image[0].tolist()
        result["visual_alignment"]=dict(zip(LABELS,raw))
    ocr=os.environ.get("INFRARED_OCR","rapidocr")
    if ocr in ("1","rapidocr"):
        if ocr=="rapidocr":
            from rapidocr_onnxruntime import RapidOCR
            rows,_=RapidOCR(intra_op_num_threads=2,inter_op_num_threads=2)(np.asarray(image))
            text=" ".join(row[1] for row in rows or [])[:8192]
        else:
            import pytesseract
            text=pytesseract.image_to_string(image,timeout=20)[:8192]
        result["ocr_words"]=len(text.split())
        path=model_path("INFRARED_COPY_MODEL","copy")
        if text.strip() and path:
            model=load_copy(path)
            vectors=model.encode([text,*LABELS],normalize_embeddings=True)
            result["copy_similarity"]=dict(zip(LABELS,(vectors[1:]@vectors[0]).tolist()))
    return result
