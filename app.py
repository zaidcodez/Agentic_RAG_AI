from flask import Flask, request, jsonify, render_template, Response, stream_with_context
from flask_cors import CORS
from api import load_and_store, answer_query
import os
import database
import json

# ----------------------------
# Flask setup
# ----------------------------
app = Flask(__name__)
CORS(app)

# Initialize database
database.init_db()

# ----------------------------
# Serve frontend (index.html)
# ----------------------------
@app.route("/")
def serve_html():
    return render_template("index.html")

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
        level = data.get("level", "standard")
        mode = data.get("mode", "standard")
        stream = data.get("stream", False)
        is_concept_check = data.get("is_concept_check", False)
        pinned_contexts = data.get("pinned_contexts", [])

        if not query and not (is_concept_check and pinned_contexts):
            return jsonify({"error": "Query cannot be empty"}), 400

        # If no session_id is provided, create a new one using the query as title
        if not session_id:
            title = (query[:80] + "..") if query and len(query) > 80 else (query or "New Concept Check")
            session_id = database.create_session(title)

        # Retrieve chat history
        history = database.get_messages(session_id)

        if is_concept_check:
            # Concept Check Generation Flow
            topic = query
            if pinned_contexts:
                topic = "Context: " + " ".join(pinned_contexts) + "\nQuery: " + topic
                
            def generate_concept_check_stream():
                try:
                    # Yield a placeholder token so frontend shows something
                    yield f"data: {json.dumps({'token': 'Generating concept check... Please wait.'})}\n\n"
                    # Lenient Validator
                    from api import llm
                    from langchain_core.messages import SystemMessage, HumanMessage
                    
                    val_res = llm.invoke([
                        SystemMessage(content="""
                            You are a study topic validator.
                            Criteria:
                            1. If the input contains 'Context:', the user has pinned a reference. ALWAYS reply 'VALID'.
                            2. If no 'Context:' exists, only reply 'INVALID' if the query is extremely vague (e.g., 'hi', 'quiz', 'test', or empty).
                            3. Otherwise, reply 'VALID'.
                            Reply exactly with 'VALID' or 'INVALID'.
                        """),
                        HumanMessage(content=topic)
                    ])
                    
                    if "INVALID" in val_res.content.upper():
                        error_msg = "This topic is too vague for a quiz. Please pin a message or type a more specific concept."
                        yield f"data: {json.dumps({'error': error_msg})}\n\n"
                        return


                    from api import generate_concept_questions
                    questions = generate_concept_questions(topic)
                    
                    if questions:
                        # Save messages
                        database.add_message(session_id, "user", query)
                        ai_msg_id = database.add_message(session_id, "ai", "Here are some diagnostic questions to evaluate your understanding.")
                        widget_id = database.add_widget(ai_msg_id, "concept_check", questions)
                        
                        yield f"data: {json.dumps({'message_id': ai_msg_id, 'widget_id': widget_id, 'concept_check': True, 'questions': questions, 'done': True})}\n\n"
                    else:
                        yield f"data: {json.dumps({'error': 'Failed to generate concept check.'})}\n\n"
                except Exception as e:
                    print("❌ Error in concept check stream:", e)
                    yield f"data: {json.dumps({'error': str(e)})}\n\n"
            
            response = Response(stream_with_context(generate_concept_check_stream()), mimetype='text/event-stream')
            response.headers['Cache-Control'] = 'no-cache'
            response.headers['X-Accel-Buffering'] = 'no'
            return response

        elif stream:
            gen, sources = answer_query(query, chat_history=history, level=level, mode=mode, stream=True, session_id=session_id, pinned_contexts=pinned_contexts)
            
            def generate():
                full_response = ""
                # Send metadata first
                yield f"data: {json.dumps({'session_id': session_id, 'sources': sources})}\n\n"
                
                for chunk in gen:
                    if hasattr(chunk, 'content'):
                        token = chunk.content
                    else:
                        token = str(chunk)
                    full_response += token
                    yield f"data: {json.dumps({'token': token})}\n\n"
                
                # Save BOTH messages ONLY after generation succeeds
                database.add_message(session_id, "user", query)
                ai_msg_id = database.add_message(session_id, "ai", full_response)
                yield f"data: {json.dumps({'message_id': ai_msg_id, 'done': True})}\n\n"
                
            response = Response(stream_with_context(generate()), mimetype='text/event-stream')
            response.headers['Cache-Control'] = 'no-cache'
            response.headers['X-Accel-Buffering'] = 'no'
            return response

        else:
            # Call the answer function from api.py with history context and level
            result = answer_query(query, chat_history=history, level=level, mode=mode, stream=False, session_id=session_id, pinned_contexts=pinned_contexts)
            response_text = result["response"]
            sources = result["sources"]

            # Save BOTH messages ONLY after generation succeeds
            database.add_message(session_id, "user", query)
            ai_msg_id = database.add_message(session_id, "ai", response_text)

            # Return response, session_id, and sources
            return jsonify({
                "response": response_text,
                "session_id": session_id,
                "message_id": ai_msg_id,
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
        if not data or "text" not in data or "message_id" not in data:
            return jsonify({"error": "Missing 'text' or 'message_id' in request"}), 400

        from api import generate_flashcards
        cards = generate_flashcards(data["text"])
        if cards:
            widget_id = database.add_widget(data["message_id"], "flashcard", cards)
            return jsonify({"flashcards": cards, "widget_id": widget_id})
        else:
            return jsonify({"error": "Failed to generate flashcards"}), 500

    except Exception as e:
        print("❌ Error in /api/flashcards:", e)
        return jsonify({"error": str(e)}), 500

# ----------------------------
# Quiz endpoint
# ----------------------------
@app.route("/api/quiz", methods=["POST"])
def quiz():
    try:
        data = request.get_json()
        if not data or "text" not in data or "message_id" not in data:
            return jsonify({"error": "Missing 'text' or 'message_id' in request"}), 400

        from api import generate_quiz
        quiz_data = generate_quiz(data["text"])
        if quiz_data:
            widget_id = database.add_widget(data["message_id"], "quiz", quiz_data)
            return jsonify({"quiz": quiz_data, "widget_id": widget_id})
        else:
            return jsonify({"error": "Failed to generate quiz"}), 500

    except Exception as e:
        print("❌ Error in /api/quiz:", e)
        return jsonify({"error": str(e)}), 500

# ----------------------------
# Concept Check endpoints
# ----------------------------
@app.route("/api/concept_check/generate", methods=["POST"])
def generate_concept_check():
    try:
        data = request.get_json()
        if not data or "text" not in data or "message_id" not in data:
            return jsonify({"error": "Missing 'text' or 'message_id' in request"}), 400

        from api import generate_concept_questions
        questions = generate_concept_questions(data["text"])
        if questions:
            widget_id = database.add_widget(data["message_id"], "concept_check", questions)
            return jsonify({"questions": questions, "widget_id": widget_id})
        else:
            return jsonify({"error": "Failed to generate concept check"}), 500

    except Exception as e:
        print("❌ Error in /api/concept_check/generate:", e)
        return jsonify({"error": str(e)}), 500


@app.route("/api/concept_check/evaluate", methods=["POST"])
def evaluate_concept_check():
    try:
        data = request.get_json()
        if not data or "session_id" not in data or "questions" not in data or "answers" not in data or "original_text" not in data:
            return jsonify({"error": "Missing required fields"}), 400

        from api import evaluate_concept_answers
        evaluation = evaluate_concept_answers(data["questions"], data["answers"], data["original_text"])
        
        if evaluation:
            # Add user context as a message (hidden or not, let's keep it transparent)
            database.add_message(data["session_id"], "user", "I have submitted my answers to the concept check.")
            # Add AI explanation as a message
            ai_msg_id = database.add_message(data["session_id"], "ai", evaluation)
            
            return jsonify({"evaluation": evaluation, "message_id": ai_msg_id})
        else:
            return jsonify({"error": "Failed to evaluate concept check"}), 500

    except Exception as e:
        print("❌ Error in /api/concept_check/evaluate:", e)
        return jsonify({"error": str(e)}), 500

# ----------------------------
# Widget State endpoint
# ----------------------------
@app.route("/api/widgets/<int:widget_id>/state", methods=["PUT"])
def update_widget_state(widget_id):
    try:
        state_data = request.get_json()
        database.update_widget_state(widget_id, state_data)
        return jsonify({"message": "State updated"})
    except Exception as e:
        print("❌ Error in /api/widgets/state:", e)
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

        session_id = request.form.get("session_id")
        
        # If no session_id is provided, create a new one
        if not session_id or session_id == "null":
            title = f"Document: {file.filename}"
            session_id = database.create_session(title)

        os.makedirs("data", exist_ok=True)
        file_path = os.path.join("data", file.filename)
        file.save(file_path)

        load_and_store(file_path, session_id=session_id)

        return jsonify({
            "message": f"✅ File '{file.filename}' uploaded and processed successfully.",
            "session_id": session_id
        })

    except Exception as e:
        print("❌ Error in /api/upload:", e)
        return jsonify({"error": str(e)}), 500

# ----------------------------
# Run the Flask app
# ----------------------------
if __name__ == "__main__":
    app.run(debug=True, port=5000)
