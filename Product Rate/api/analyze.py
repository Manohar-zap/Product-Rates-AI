"""
api/analyze.py — Vercel Python Serverless Function
Vercel expects a Flask WSGI app exported as `app` (using @vercel/python runtime)
"""

import sys
import os

# Add project root to path so analyzer.py can be imported
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from flask import Flask, request, jsonify
from flask_cors import CORS
from analyzer import analyze_product

app = Flask(__name__)
CORS(app)


@app.route('/api/analyze', methods=['POST'])
def analyze():
    if 'image' not in request.files:
        return jsonify({"error": "No image file provided"}), 400

    file = request.files['image']

    if file.filename == '':
        return jsonify({"error": "Empty filename"}), 400

    allowed = {'jpg', 'jpeg', 'png', 'webp'}
    ext = file.filename.rsplit('.', 1)[-1].lower() if '.' in file.filename else ''
    if ext not in allowed:
        return jsonify({"error": f"File type '{ext}' not supported. Use JPG, PNG, or WebP."}), 400

    try:
        image_bytes = file.read()
        result = analyze_product(image_bytes)
        return jsonify(result), 200

    except Exception as e:
        return jsonify({"error": str(e)}), 500


# Vercel calls this file as a module — the `app` object is the WSGI handler
