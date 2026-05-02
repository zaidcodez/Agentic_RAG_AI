from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from api import load_and_store, answer_query
import os
import database

# ----------------------------
# Flask setup
# ----------------------------
app = Flask(__name__, static_folder=".", static_url_path="")
CORS(app)

# Initialize database
database.init_db()

# ----------------------------
# Serve frontend (index.html)
# ----------------------------
@app.route("/")
def serve_html():
    return send_from_directory(".", "index.html")

# ----------------------------
# Session management endpoints
# ----------------------------
@app.route("/api/sessions", methods=["GET"])
def get_sessions():
    try:
        sessions = database.get_sessions()
        return jsonify({"sessions": sessions})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/sessions", methods=["POST"])
def create_session():
    try:
        data = request.get_json()
        title = data.get("title", "New Session")
        session_id = database.create_session(title)
        return jsonify({"session_id": session_id})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/sessions/<int:session_id>", methods=["DELETE"])
def delete_session(session_id):
    try:
        database.delete_session(session_id)
        return jsonify({"message": "Session deleted successfully"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/chat/<int:session_id>", methods=["GET"])
def get_chat_history(session_id):
    try:
        messages = database.get_messages(session_id)
        return jsonify({"messages": messages})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

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
        session_id = data.get("session_id")

        if not query:
            return jsonify({"error": "Query cannot be empty"}), 400

        # If no session_id is provided, create a new one using the query as title
        if not session_id:
            title = query[:30] + "..." if len(query) > 30 else query
            session_id = database.create_session(title)

        # Retrieve chat history
        history = database.get_messages(session_id)

        # Call the answer function from api.py with history context and level
        level = data.get("level", "standard")
        result = answer_query(query, chat_history=history, level=level)
        response_text = result["response"]
        sources = result["sources"]

        # Save BOTH messages ONLY after generation succeeds
        # This prevents DB corruption if the user aborts the request
        database.add_message(session_id, "user", query)
        database.add_message(session_id, "ai", response_text)

        # Return response, session_id, and sources
        return jsonify({
            "response": response_text,
            "session_id": session_id,
            "sources": sources
        })

    except Exception as e:
        print("❌ Error in /api/chat:", e)
        return jsonify({"error": str(e)}), 500

# ----------------------------
# Flashcard endpoint
# ----------------------------
@app.route("/api/flashcards", methods=["POST"])
def flashcards():
    try:
        data = request.get_json()
        if not data or "text" not in data:
            return jsonify({"error": "Missing 'text' in request"}), 400

        from api import generate_flashcards
        cards = generate_flashcards(data["text"])
        return jsonify({"flashcards": cards})

    except Exception as e:
        print("❌ Error in /api/flashcards:", e)
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
