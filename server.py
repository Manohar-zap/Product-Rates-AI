"""
server.py — Flask development server for Product Rates AI
Run: python server.py
Serves POST /api/analyze and all static files from /public
"""

import os

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

from analyzer import analyze_product

app = Flask(__name__, static_folder="public")
CORS(app)

# Path to the output directory for JSON data
OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "output")


# ─────────────────────────────────────────
# API endpoint
# ─────────────────────────────────────────
@app.route("/api/analyze", methods=["POST"])
def analyze():
    if "image" not in request.files:
        return jsonify({"error": "No image file provided"}), 400

    file = request.files["image"]

    if file.filename == "":
        return jsonify({"error": "Empty filename"}), 400

    allowed = {"jpg", "jpeg", "png", "webp"}
    ext = file.filename.rsplit(".", 1)[-1].lower()
    if ext not in allowed:
        return jsonify(
            {"error": f"File type '{ext}' not supported. Use JPG, PNG, or WebP."}
        ), 400

    try:
        image_bytes = file.read()
        result = analyze_product(image_bytes)
        return jsonify(result), 200

    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ─────────────────────────────────────────
# Data API endpoint (serves output JSONs)
# ─────────────────────────────────────────
@app.route("/api/data/<path:path>")
def serve_data(path):
    full_path = os.path.join(OUTPUT_DIR, path)
    if path and os.path.exists(full_path):
        return send_from_directory(OUTPUT_DIR, path)
    return jsonify({"error": "Data file not found"}), 404


# ─────────────────────────────────────────
# Directory listing endpoint
# ─────────────────────────────────────────
@app.route("/api/list/<folder>")
def list_folder(folder):
    folder_path = os.path.join(OUTPUT_DIR, folder)
    if not os.path.isdir(folder_path):
        return jsonify({"error": "Folder not found"}), 404
    files = [f for f in os.listdir(folder_path) if f.endswith('.json')]
    files.sort()
    return jsonify(files), 200


# ─────────────────────────────────────────
# Search product by name (uses SerpApi)
# ─────────────────────────────────────────
@app.route("/api/search-product", methods=["POST"])
def search_product():
    data = request.get_json()
    query = data.get("query", "").strip()
    if not query:
        return jsonify({"error": "No query provided"}), 400
    try:
        from analyzer import search_serpapi, SERPAPI_KEYS
        import json, re

        if not SERPAPI_KEYS:
            return jsonify({"error": "SerpApi key not configured. Please add SERPAPI_KEY to .env"}), 500

        # Search for the product specifically as a skincare/beauty product
        search_text = search_serpapi(f"{query} skincare beauty product buy")
        
        # Build basic product list from search (name+brand extraction)
        products = []
        lines = search_text.split("\n")
        seen = set()
        for line in lines:
            line = line.strip()
            if len(line) > 10 and query.lower() in line.lower():
                key = line[:50]
                if key not in seen:
                    seen.add(key)
                    products.append({"name": query, "brand": "", "snippet": line[:120]})
                    if len(products) >= 5:
                        break

        # If no matches, still return the query as the product
        if not products:
            products = [{"name": query, "brand": "", "snippet": f"Analyze '{query}' using AI"}]

        return jsonify({"products": products}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ─────────────────────────────────────────
# Analyze product by name (no image)
# ─────────────────────────────────────────
@app.route("/api/analyze-by-name", methods=["POST"])
def analyze_by_name():
    data = request.get_json()
    product_name = data.get("product_name", "").strip()
    brand = data.get("brand", "").strip()

    if not product_name:
        return jsonify({"error": "No product name provided"}), 400

    try:
        from analyzer import search_serpapi, _generate_with_fallback
        import json

        # Step 1: Search for ingredients using SerpApi
        query = f"{brand} {product_name} full ingredients INCI list".strip()
        search_text = search_serpapi(query)

        # Step 2: Generate full analysis using Gemini (text-only, no image)
        prompt = f"""
You are an expert skincare and cosmetic product advisor.

Product Name: {product_name}
Brand: {brand}
{f"Web search results for ingredients:\\n{search_text}" if search_text else ""}

Based on the above, provide a comprehensive ingredient analysis.
Return ONLY valid JSON in this exact format:

{{
  "product_name": "{product_name}",
  "brand": "{brand}",
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
  "skin_types": {{"oily":"","dry":"","combination":"","normal":"","sensitive":"","acne_prone":""}},
  "contains": {{"fragrance":false,"parabens":false,"sulfates":false,"silicones":false,"drying_alcohol":false,"mineral_oil":false}},
  "ingredients": [{{"name":"","purpose":"","good_or_bad":"Good | Neutral | Use with Caution","simple_explanation":""}}],
  "ingredients_to_watch": [{{"name":"","why":"","who_should_avoid":[]}}],
  "hero_ingredients": [{{"name":"","benefit":""}}],
  "possible_allergens": [],
  "pregnancy": "",
  "safe_for_children": "",
  "daily_use": "",
  "final_verdict": "",
  "confidence": 0
}}

Rules:
1. Use web search results for accurate ingredients. Never invent ingredients.
2. Explain everything in simple language.
3. Return ONLY JSON.
"""
        text, model = _generate_with_fallback(prompt, [prompt])
        result = json.loads(text)
        print(f"[server] analyze-by-name succeeded with {model}")
        return jsonify(result), 200

    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ─────────────────────────────────────────
# Static file serving
# ─────────────────────────────────────────
@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_static(path):
    if path and os.path.exists(os.path.join(app.static_folder, path)):
        return send_from_directory(app.static_folder, path)
    return send_from_directory(app.static_folder, "index.html")


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))

    print(f"[Product Rates AI] Running on port {port}")

    app.run(host="0.0.0.0", port=port, debug=False)
