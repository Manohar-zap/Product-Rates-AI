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
