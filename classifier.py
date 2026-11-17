"""Zero-shot waste classifier using OpenAI CLIP (runs locally).

The model (~600 MB) is downloaded from Hugging Face on first run and cached.
"""
import threading

import torch
from PIL import Image
from transformers import CLIPModel, CLIPProcessor

MODEL_NAME = "openai/clip-vit-base-patch32"

# Each category: display info + several text prompts CLIP compares the image to.
CATEGORIES = {
    "metal": {
        "label": "Metal",
        "led": "Red",
        "bin": "Metal recycling bin",
        "tip": "Rinse cans and tins. Metals are infinitely recyclable.",
        "prompts": [
            "a photo of an aluminium soda can",
            "a photo of a metal tin can",
            "a photo of scrap metal",
            "a photo of a steel object",
            "a photo of metal cutlery, spoons and forks",
            "a photo of a metal pipe or rod",
            "a photo of nails, screws and bolts",
            "a photo of an aerosol spray can",
            "a photo of aluminium foil",
            "a photo of a metal pan or pot",
        ],
    },
    "plastic": {
        "label": "Plastic",
        "led": "White",
        "bin": "Plastic recycling bin",
        "tip": "Empty and flatten bottles. Remove caps if your area requires it.",
        "prompts": [
            "a photo of a plastic bottle",
            "a photo of a plastic bag",
            "a photo of a plastic container",
            "a photo of plastic packaging or wrapper",
            "a photo of a plastic cup or straw",
            "a photo of a plastic toy",
            "a photo of a plastic bucket",
            "a photo of plastic cutlery",
            "a photo of a crushed plastic bottle",
        ],
    },
    "ewaste": {
        "label": "E-Waste",
        "led": "Green",
        "bin": "E-waste collection centre",
        "tip": "Never bin electronics. Batteries and boards contain hazardous materials.",
        "prompts": [
            "a photo of a computer motherboard",
            "a photo of a printed circuit board with electronic components",
            "a photo of an old mobile phone",
            "a photo of a laptop",
            "a photo of a computer keyboard or mouse",
            "a photo of electronic wires and cables",
            "a photo of a battery",
            "a photo of a hard disk drive",
            "a photo of a computer monitor or television",
            "a photo of a charger or power adapter",
            "a photo of a RAM stick or computer chip",
            "a photo of electronic waste",
        ],
    },
    # Not one of the 3 sorted types - kept so paper/glass/food are not forced into a wrong bin.
    "other": {
        "label": "Other waste",
        "led": "Blink all + long beep",
        "bin": "General / dry waste bin",
        "tip": "Not metal, plastic or e-waste. Check it and sort it by hand.",
        "prompts": [
            "a photo of a cardboard box",
            "a photo of newspaper or paper sheets",
            "a photo of a paper bag or crumpled paper",
            "a photo of a glass bottle or jar",
            "a photo of coloured glass beer bottles",
            "a photo of brown, green or blue glass bottles",
            "a photo of a glass wine bottle",
            "a photo of broken glass",
            "a photo of food waste or fruit peels",
            "a photo of leaves and plant waste",
            "a photo of cloth or fabric",
        ],
    },
}

MIN_CONFIDENCE = 0.30  # below this the result is reported as "unknown"


def _as_tensor(features):
    """transformers v5 returns a model-output object; v4 returns the tensor directly."""
    return features if isinstance(features, torch.Tensor) else features.pooler_output


class WasteClassifier:
    def __init__(self):
        self.model = None
        self.processor = None
        self.text_features = None
        self.prompt_owner = []  # category key for each prompt
        self.status = "loading"
        self.error = None
        self._lock = threading.Lock()
        self.device = "cuda" if torch.cuda.is_available() else "cpu"

    def load(self):
        try:
            self.processor = CLIPProcessor.from_pretrained(MODEL_NAME)
            self.model = CLIPModel.from_pretrained(MODEL_NAME).to(self.device).eval()

            prompts = []
            for key, cat in CATEGORIES.items():
                for p in cat["prompts"]:
                    prompts.append(p)
                    self.prompt_owner.append(key)

            with torch.no_grad():
                tokens = self.processor(text=prompts, return_tensors="pt", padding=True).to(self.device)
                feats = _as_tensor(self.model.get_text_features(**tokens))
                self.text_features = feats / feats.norm(dim=-1, keepdim=True)
            self.status = "ready"
        except Exception as exc:  # noqa: BLE001
            self.status = "error"
            self.error = str(exc)
            raise

    def classify(self, image: Image.Image) -> dict:
        if self.status != "ready":
            raise RuntimeError(f"Model not ready ({self.status})")

        with self._lock, torch.no_grad():
            inputs = self.processor(images=image.convert("RGB"), return_tensors="pt").to(self.device)
            img = _as_tensor(self.model.get_image_features(**inputs))
            img = img / img.norm(dim=-1, keepdim=True)
            logits = self.model.logit_scale.exp() * img @ self.text_features.T
            probs = logits.softmax(dim=-1)[0].cpu().tolist()

        scores = {k: 0.0 for k in CATEGORIES}
        best_prompt = {k: ("", 0.0) for k in CATEGORIES}
        for prob, owner, prompt in zip(probs, self.prompt_owner, self._all_prompts()):
            scores[owner] += prob
            if prob > best_prompt[owner][1]:
                best_prompt[owner] = (prompt, prob)

        ranked = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
        top_key, top_score = ranked[0]
        category = top_key if top_score >= MIN_CONFIDENCE else "unknown"

        return {
            "category": category,
            "confidence": round(top_score, 4),
            "matched": best_prompt[top_key][0].replace("a photo of ", ""),
            "scores": {k: round(v, 4) for k, v in ranked},
        }

    def _all_prompts(self):
        for cat in CATEGORIES.values():
            yield from cat["prompts"]
