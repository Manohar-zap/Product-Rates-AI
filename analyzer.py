import os
import json
import io
import requests
import itertools
from google import genai
from dotenv import load_dotenv
from PIL import Image

# Load .env file
load_dotenv()

def get_api_keys(prefix="GEMINI_API_KEY"):
    keys = []
    # Primary key
    if os.getenv(prefix):
        keys.append(os.getenv(prefix))
    # Fallback keys 1 through 10
    for i in range(1, 11):
        key = os.getenv(f"{prefix}_{i}")
        if key:
            keys.append(key)
    return keys

GEMINI_KEYS = get_api_keys("GEMINI_API_KEY")
SERPAPI_KEYS = get_api_keys("SERPAPI_KEY")

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
    """Returns True if we should skip to the next model/key (quota exhausted, model unavailable)."""
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
        or "400"           in msg  # invalid request
        or "invalid"       in msg
    )

def _generate_with_fallback(prompt, image_or_contents):
    """Tries models and keys until one succeeds, returns text and successful model."""
    if not GEMINI_KEYS:
        raise Exception("No GEMINI_API_KEY found in environment variables.")

    last_error = None
    tried_models = []

    for model in FALLBACK_MODELS:
        tried_models.append(model)
        for key in GEMINI_KEYS:
            try:
                client = genai.Client(api_key=key)
                print(f"[analyzer] Trying {model} with Gemini key ...{key[-4:]}")
                
                contents = []
                if isinstance(image_or_contents, list):
                    contents = image_or_contents
                else:
                    contents = [prompt, image_or_contents]
                    
                response = client.models.generate_content(
                    model=model,
                    contents=contents
                )
                
                text = response.text.strip()
                # Remove markdown fences if Gemini returns ```json
                text = text.replace("```json", "").replace("```", "").strip()
                return text, model
                
            except Exception as e:
                if _should_try_next(e):
                    print(f"[analyzer] Skipping key/model due to: {type(e).__name__} - {e}")
                    last_error = e
                    continue
                else:
                    raise

    raise Exception(f"429 RESOURCE_EXHAUSTED. Failed to generate content. Models tried: {tried_models}. Last error: {last_error}")

def _fetch_page_text(url, max_chars=4000):
    """Fetch a webpage and extract readable text, looking for ingredients section."""
    try:
        headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
        res = requests.get(url, headers=headers, timeout=8)
        if res.status_code != 200:
            return ""
        # Simple HTML tag stripper
        import re
        text = re.sub(r'<[^>]+>', ' ', res.text)
        text = re.sub(r'\s+', ' ', text).strip()
        # Try to find the ingredients section
        lower = text.lower()
        idx = lower.find('ingredients')
        if idx != -1:
            # Return text around the ingredients section
            start = max(0, idx)
            return text[start:start + max_chars]
        return text[:max_chars]
    except Exception as e:
        print(f"[analyzer] Page fetch failed: {e}")
        return ""

def search_serpapi(query):
    if not SERPAPI_KEYS:
        print("[analyzer] No SERPAPI_KEY found in .env, skipping web search.")
        return ""
        
    for key in SERPAPI_KEYS:
        try:
            print(f"[analyzer] Searching SerpApi for: {query}")
            url = "https://serpapi.com/search"
            params = {
                "q": query,
                "engine": "google",
                "api_key": key,
                "num": 5
            }
            res = requests.get(url, params=params, timeout=10)
            if res.status_code != 200:
                print(f"[analyzer] SerpApi error {res.status_code}")
                continue
                
            data = res.json()
            text_parts = []
            
            # 1. Check answer_box (most complete, direct answer)
            ab = data.get("answer_box", {})
            if ab.get("answer"): text_parts.append(ab["answer"])
            if ab.get("snippet"): text_parts.append(ab["snippet"])
            
            # 2. Check knowledge graph
            kg = data.get("knowledge_graph", {})
            if kg.get("description"): text_parts.append(kg["description"])
            
            # 3. Collect snippets from organic results
            organic = data.get("organic_results", [])
            for item in organic[:5]:
                if item.get("snippet"):
                    text_parts.append(item["snippet"])
                    
            # 4. Try to fetch the actual first result page for full ingredients
            if organic and organic[0].get("link"):
                page_text = _fetch_page_text(organic[0]["link"])
                if page_text:
                    text_parts.append(page_text)
                    
            if text_parts:
                return "\n\n".join(text_parts)
                
        except Exception as e:
            print(f"[analyzer] SerpApi request failed: {e}")
            continue
            
    return ""

def analyze_product(image_bytes):
    image = Image.open(io.BytesIO(image_bytes))

    # ─────────────────────────────────────────
    # STEP 1: Identify product name and brand
    # ─────────────────────────────────────────
    step1_prompt = """
    Look at this product image and identify its name and brand.
    Return ONLY a JSON object with this exact format:
    {
        "product_name": "Name of the product or 'Unknown'",
        "brand": "Brand name or 'Unknown'"
    }
    """
    
    product_name = "Unknown"
    brand = "Unknown"
    
    try:
        text1, _ = _generate_with_fallback(step1_prompt, image)
        info = json.loads(text1)
        product_name = info.get("product_name", "Unknown")
        brand = info.get("brand", "Unknown")
        print(f"[analyzer] Identified Product: {brand} - {product_name}")
    except Exception as e:
        print(f"[analyzer] Step 1 failed to identify product: {e}. Proceeding without search.")
        # We proceed anyway, using image as fallback

    # ─────────────────────────────────────────
    # STEP 2: Web Search for Ingredients
    # ─────────────────────────────────────────
    search_text = ""
    if product_name != "Unknown":
        query = f"{brand} {product_name} ingredients full list".strip()
        search_text = search_serpapi(query)

    # ─────────────────────────────────────────
    # STEP 3: Final JSON Generation
    # ─────────────────────────────────────────
    step3_prompt = f"""
You are an expert skincare and cosmetic product advisor.

I am providing an image of a product.
{f'I have also searched the web for its ingredients. Here is some text from the web:\\n{search_text}\\n' if search_text else ''}

Return ONLY valid JSON.

{{
  "product_name": "{product_name if product_name != 'Unknown' else ''}",
  "brand": "{brand if brand != 'Unknown' else ''}",
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
  "skin_types": {{
    "oily": "",
    "dry": "",
    "combination": "",
    "normal": "",
    "sensitive": "",
    "acne_prone": ""
  }},
  "contains": {{
    "fragrance": false,
    "parabens": false,
    "sulfates": false,
    "silicones": false,
    "drying_alcohol": false,
    "mineral_oil": false
  }},
  "ingredients": [
    {{
      "name": "",
      "purpose": "",
      "good_or_bad": "Good | Neutral | Use with Caution",
      "simple_explanation": ""
    }}
  ],
  "ingredients_to_watch": [
    {{
      "name": "",
      "why": "",
      "who_should_avoid": []
    }}
  ],
  "hero_ingredients": [
    {{
      "name": "",
      "benefit": ""
    }}
  ],
  "possible_allergens": [],
  "pregnancy": "",
  "safe_for_children": "",
  "daily_use": "",
  "final_verdict": "",
  "confidence": 0
}}

Rules:
1. Use the provided web text for the ingredient list if available. Otherwise, read the ingredients directly visible in the image.
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
    
    text3, final_model = _generate_with_fallback(step3_prompt, image)
    
    try:
        result = json.loads(text3)
        print(f"[analyzer] Success with final model: {final_model}")
        return result
    except json.JSONDecodeError:
        raise Exception(f"Gemini did not return valid JSON.\n\nResponse:\n{text3}")