from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from api import load_and_store, answer_query  # ✅ uses your api.py
import os

# ----------------------------
# Flask setup
# ----------------------------
app = Flask(__name__, static_folder=".", static_url_path="")
CORS(app)

# ----------------------------
# Serve frontend (index.html)
# ----------------------------
@app.route("/")
def serve_html():
    return send_from_directory(".", "index.html")

# ----------------------------
# Chat endpoint
# ----------------------------
@app.route("/api/chat", methods=["POST"])
def chat():
    try:
        data = request.get_json()
        if not data or "query" not in data:
            return jsonify({"error": "Missing 'query' in request"}), 400

        query = data["query"].strip()
        if not query:
            return jsonify({"error": "Query cannot be empty"}), 400

        # Call the answer function from api.py
        response_text = answer_query(query)

        # Ensure output is JSON-compatible
        return jsonify({"response": response_text})

    except Exception as e:
        print("❌ Error in /api/chat:", e)
        return jsonify({"error": str(e)}), 500

# ----------------------------
# Upload endpoint
# ----------------------------
@app.route("/api/upload", methods=["POST"])
def upload_file():
    try:
        if "file" not in request.files:
            return jsonify({"error": "No file uploaded"}), 400

        file = request.files["file"]
        if not file.filename:
            return jsonify({"error": "Invalid file name"}), 400

        os.makedirs("data", exist_ok=True)
        file_path = os.path.join("data", file.filename)
        file.save(file_path)

        load_and_store(file_path)

        return jsonify({"message": f"✅ File '{file.filename}' uploaded and processed successfully."})

    except Exception as e:
        print("❌ Error in /api/upload:", e)
        return jsonify({"error": str(e)}), 500

# ----------------------------
# Run the Flask app
# ----------------------------
if __name__ == "__main__":
    app.run(debug=True, port=5000)
