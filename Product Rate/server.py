"""
server.py — Flask development server for Product Rates AI
Run: python server.py
Serves POST /api/analyze and all static files from /public
"""

from flask import Flask, request, jsonify, send_from_directory, send_file
from flask_cors import CORS
from analyzer import analyze_product
import os

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
        return jsonify({"error": f"File type '{ext}' not supported. Use JPG, PNG, or WebP."}), 400

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
    print("\n[Product Rates AI] Development Server running at http://localhost:5000\n")
    app.run(debug=True, port=5000)
