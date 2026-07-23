from google import genai
from dotenv import load_dotenv
from PIL import Image
import io
import os
import json

# Load .env file
load_dotenv()

client = genai.Client(
    api_key=os.getenv("GEMINI_API_KEY")
)

# Model waterfall — tried in order, auto-skips on quota OR model-not-found errors
FALLBACK_MODELS = [
    "models/gemini-3.1-flash-lite",
    "models/gemini-3-flash-preview",
    "models/gemini-2.5-flash-lite",
    "models/gemini-2.5-flash",
    "models/gemini-2.0-flash-lite",
    "models/gemini-2.0-flash",
]

def _should_try_next(err: Exception) -> bool:
    """Returns True if we should skip to the next model (quota exhausted OR model unavailable)."""
    msg = str(err).lower()
    return (
        "429"              in msg  # rate limit
        or "resource_exhausted" in msg
        or "quota"         in msg
        or "exhausted"     in msg
        or "404"           in msg  # model not found / deprecated
        or "not_found"     in msg
        or "no longer available" in msg
        or "deprecated"    in msg
    )

def analyze_product(image_bytes):
    image = Image.open(io.BytesIO(image_bytes))

    prompt = """
You are an expert skincare and cosmetic product advisor.

Analyze the product image.

Return ONLY valid JSON.

{
  "product_name": "",
  "brand": "",
  "category": "",

  "overall_rating": 0,

  "buy_recommendation": "Yes | Maybe | No",

  "quick_summary": "",

  "best_for": [],

  "not_recommended_for": [],

  "pros": [],

  "cons": [],

  "good_points": [],

  "things_to_know": [],

  "skin_types": {
    "oily": "",
    "dry": "",
    "combination": "",
    "normal": "",
    "sensitive": "",
    "acne_prone": ""
  },

  "contains": {
    "fragrance": false,
    "parabens": false,
    "sulfates": false,
    "silicones": false,
    "drying_alcohol": false,
    "mineral_oil": false
  },

  "ingredients": [
    {
      "name": "",
      "purpose": "",
      "good_or_bad": "Good | Neutral | Use with Caution",
      "simple_explanation": ""
    }
  ],

  "ingredients_to_watch": [
    {
      "name": "",
      "why": "",
      "who_should_avoid": []
    }
  ],

  "hero_ingredients": [
    {
      "name": "",
      "benefit": ""
    }
  ],

  "possible_allergens": [],

  "pregnancy": "",

  "safe_for_children": "",

  "daily_use": "",

  "final_verdict": "",

  "confidence": 0
}

Rules:

1. Read ONLY the ingredients actually visible in the image.
2. Never invent ingredients.
3. Explain everything in simple language suitable for a teenager.
4. Avoid scientific or medical jargon unless absolutely necessary.
5. Focus on helping the user decide whether the product is right for them.
6. For every harmful ingredient, explain:
   - Why it may be a concern.
   - Which skin types should avoid it.
7. For every beneficial ingredient, explain what it does in one short sentence.
8. The quick_summary must be 2–3 simple sentences.
9. The final_verdict must be short, friendly, and easy to understand.
10. Overall rating must be between 0 and 10.
11. Confidence must be between 0 and 100.
12. Return ONLY JSON.
"""

    last_error = None
    tried = []

    for model in FALLBACK_MODELS:
        tried.append(model)
        try:
            print(f"[analyzer] Trying model: {model}")
            response = client.models.generate_content(
                model=model,
                contents=[prompt, image]
            )

            text = response.text.strip()

            # Remove markdown fences if Gemini returns ```json
            text = text.replace("```json", "").replace("```", "").strip()

            try:
                result = json.loads(text)
                print(f"[analyzer] Success with model: {model}")
                return result

            except json.JSONDecodeError:
                raise Exception(
                    f"Gemini did not return valid JSON.\n\nResponse:\n{text}"
                )

        except Exception as e:
            if _should_try_next(e):
                print(f"[analyzer] Skipping {model}: {type(e).__name__}")
                last_error = e
                continue  # try next model in the waterfall
            else:
                raise  # surface non-retriable errors immediately

    # All models exhausted
    raise Exception(
        f"429 RESOURCE_EXHAUSTED. All {len(tried)} models hit quota limits. "
        f"Tried: {', '.join(tried)}. "
        "Please wait until tomorrow or upgrade your Gemini API plan."
    )