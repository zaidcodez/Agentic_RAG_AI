from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from llm import load_and_store, answer_query
import os

app = Flask(__name__, static_folder=".", static_url_path="")
CORS(app)

@app.route("/")
def serve_html():
    # Serve the frontend HTML
    return send_from_directory(".", "index.html")

@app.route("/llm/chat", methods=["POST"])
def chat():
    data = request.get_json()
    query = data.get("query", "")
    if not query:
        return jsonify({"error": "Query missing"}), 400

    response = answer_query(query)
    return jsonify({"response": response})

@app.route("/llm/upload", methods=["POST"])
def upload():
    if "file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400

    file = request.files["file"]
    os.makedirs("uploads", exist_ok=True)
    file_path = os.path.join("uploads", file.filename)
    file.save(file_path)
    load_and_store(file_path)
    return jsonify({"message": f"File '{file.filename}' uploaded and processed successfully."})

if __name__ == "__main__":
    app.run(debug=True, port=5000)
