"""Optional CLIP baseline. Advice stays disabled until held-out evaluation passes."""
from pathlib import Path
import json
import threading

CLASSES = ["flat","debris","step","gap","blocked","unknown"]
PROMPTS = ["a photo of flat clear floor", "a photo of loose debris and rubble on the floor",
           "a photo of a step or ledge", "a photo of a gap or hole in the floor",
           "a photo of a wall or obstacle blocking the way"]
ACTIONS = {"flat":"continue", "debris":"slow", "step":"slow", "gap":"stop", "blocked":"steer", "unknown":"slow"}


def fuse(rule_class, rule_confidence, rule_action, camera_class, camera_confidence):
    if rule_class not in CLASSES or camera_class not in CLASSES:
        raise ValueError("invalid terrain class")
    c_rule,c_cam = max(0,min(1,rule_confidence)),max(0,min(1,camera_confidence))
    confidence = 1-(1-c_rule)*(1-c_cam) if rule_class == camera_class else c_rule*(1-0.5*c_cam)
    rank = {"continue":0,"slow":1,"steer":2,"stop":3}
    suggested = ACTIONS[camera_class]
    action = max((rule_action,suggested),key=lambda value:rank[value])
    return {"terrain_class":rule_class,"confidence":confidence,"action":action}


class TerrainClassifier:
    def __init__(self,config):
        self.config = config
        self.model = self.processor = None
        self.lock = threading.RLock()

    def _load(self):
        if self.model is None:
            from transformers import CLIPModel,CLIPProcessor
            model_name = "openai/clip-vit-base-patch32"
            self.model = CLIPModel.from_pretrained(model_name).eval()
            self.processor = CLIPProcessor.from_pretrained(model_name)

    def embed(self,image):
        import torch
        import numpy as np
        from PIL import Image
        with self.lock:
            self._load()
            if isinstance(image,(str,Path)):
                image = Image.open(image).convert("RGB")
            inputs = self.processor(images=image,return_tensors="pt")
            with torch.no_grad():
                features = self.model.get_image_features(**inputs)
                if not isinstance(features,torch.Tensor):
                    features = features.pooler_output
                features = features/features.norm(dim=-1,keepdim=True)
            return features[0].cpu().numpy()

    def predict_baseline(self,image):
        """Explicit experimental call, not enabled advice for the robot."""
        import torch
        from PIL import Image
        from transformers import CLIPModel,CLIPProcessor
        with self.lock:
            self._load()
            if isinstance(image,(str,Path)):
                image = Image.open(image).convert("RGB")
            inputs = self.processor(text=PROMPTS,images=image,return_tensors="pt",padding=True)
            with torch.no_grad():
                probabilities = self.model(**inputs).logits_per_image.softmax(dim=1)[0]
            index = int(probabilities.argmax())
            confidence = float(probabilities[index])
            return (CLASSES[index],confidence) if confidence >= self.config.terrain["terrain_min_conf"] else ("unknown",confidence)

    def classify(self,image):
        # No public sample image proves held-out run accuracy. Keep the
        # operational endpoint inactive until evaluation is supplied.
        if not self.config.terrain.get("enabled") or not self.config.terrain.get("evaluated"):
            return "unknown",0.0
        folder = self.config.data_dir
        report_path,model_path = folder/"terrain-evaluation.json",folder/"terrain_model.joblib"
        if not report_path.exists() or not model_path.exists():
            return "unknown",0.0
        report = json.loads(report_path.read_text())
        if not report.get("probe_beats_baseline",False):
            return "unknown",0.0
        import joblib
        probe = joblib.load(model_path)
        probabilities = probe.predict_proba([self.embed(image)])[0]
        index = int(probabilities.argmax())
        confidence = float(probabilities[index])
        return (str(probe.classes_[index]),confidence) if confidence >= self.config.terrain["terrain_min_conf"] else ("unknown",confidence)
