# import os
# import chromadb
# from dotenv import load_dotenv
# from langchain.schema import HumanMessage, SystemMessage
# from langchain_community.document_loaders import Docx2txtLoader, PyPDFLoader, UnstructuredPowerPointLoader
# from langchain.text_splitter import RecursiveCharacterTextSplitter
# from sentence_transformers import SentenceTransformer
# from langchain_nvidia_ai_endpoints import ChatNVIDIA
# from ddgs import DDGS  # ✅ For web search fallback

import os
import chromadb
from dotenv import load_dotenv
from langchain_core.messages import HumanMessage, SystemMessage, AIMessage
from langchain_community.document_loaders import (
    Docx2txtLoader,
    PyPDFLoader,
    UnstructuredPowerPointLoader
)
from langchain_text_splitters import RecursiveCharacterTextSplitter
from sentence_transformers import SentenceTransformer
from langchain_nvidia_ai_endpoints import ChatNVIDIA
from ddgs import DDGS

# ----------------------------
# Setup
# ----------------------------
load_dotenv()

DATA_PATH = r"data"
CHROMA_PATH = r"chroma_db"

# Get API key from env
API_KEY = os.getenv("NVIDIA_API_KEY")

# ChromaDB client
chroma_client = chromadb.PersistentClient(path=CHROMA_PATH)
collection = chroma_client.get_or_create_collection(name="chroma")

# Embedding model
embedder = SentenceTransformer("all-MiniLM-L6-v2")

# NVIDIA LLM client (Default fast model)
llm = ChatNVIDIA(
    model="meta/llama-3.1-8b-instruct",
    api_key=API_KEY,
    temperature=1,
    top_p=0.9,
    max_tokens=4096,
)

# Text splitter for chunking
splitter = RecursiveCharacterTextSplitter(chunk_size=800, chunk_overlap=100)

# ----------------------------
# Helper: Load and store documents
# ----------------------------
def load_and_store(file_path, session_id=None):
    ext = os.path.splitext(file_path)[1].lower()
    
    if ext == ".pdf":
        loader = PyPDFLoader(file_path)
    elif ext == ".docx":
        loader = Docx2txtLoader(file_path)
    elif ext in [".ppt", ".pptx"]:
        loader = UnstructuredPowerPointLoader(file_path)
    else:
        print(f"❌ Unsupported file type: {ext}")
        return
    
    docs = loader.load()
    chunks = splitter.split_documents(docs)
    
    filename = os.path.basename(file_path)
    for i, chunk in enumerate(chunks):
        emb = embedder.encode(chunk.page_content).tolist()
        metadata = {"source": filename}
        if session_id:
            metadata["session_id"] = str(session_id)
            
        chunk_id = f"{session_id}_{filename}_{i}" if session_id else f"{filename}_{i}"
        
        collection.add(
            documents=[chunk.page_content],
            metadatas=[metadata],
            ids=[chunk_id],
            embeddings=[emb]
        )
    print(f"✅ Added {len(chunks)} chunks from {file_path}")

# ----------------------------
# Helper: Detect if any docs exist in ChromaDB
# ----------------------------
def has_uploaded_docs(session_id=None):
    try:
        where_clause = {"session_id": str(session_id)} if session_id else None
        if where_clause:
            results = collection.get(where=where_clause, include=["documents"])
            return len(results["documents"]) > 0
        else:
            count = len(collection.get(include=["documents"])["documents"])
            return count > 0
    except Exception:
        return False

# ----------------------------
# Helper: Answer query
# ----------------------------
def answer_query(query, chat_history=None, level="standard", mode="standard", stream=False, session_id=None, pinned_contexts=None):
    query_lower = query.strip().lower()

    # Step 0: Study Level Instructions
    level_instruction = ""
    if level == "eli5":
        level_instruction = "IMPORTANT: Use the 'Explain Like I'm 5' approach. Use simple analogies, avoid complex jargon, and break down concepts into their most basic parts."
    elif level == "advanced":
        level_instruction = "IMPORTANT: Provide an in-depth, academic, and technical response. Use precise terminology, explore nuances, and assume the user has prior knowledge of the subject."
    else:
        level_instruction = "IMPORTANT: Provide a clear, balanced, and helpful explanation suitable for a standard student level."

    # Step 0.1: Thinking Mode Instruction
    if mode == "thinking":
        level_instruction += "\nTHINKING MODE ACTIVE: Before providing your final answer, think step-by-step. Analyze the question, consider different perspectives, and show your internal reasoning process. Be extremely thorough and analytical."

    # Step 0.2: Casual greetings
    if query_lower in ["hi", "hello", "hey", "what’s up", "yo", "good morning", "good evening"] and not stream:
        return {
            "response": "Hey there! 😊 How can I help you today?",
            "sources": []
        }

    # Step 0.3: Model Selection
    # Standard: fast and capable 70B model. Thinking: The massive 405B model.
    model_name = "meta/llama-3.1-405b-instruct" if mode == "thinking" else "meta/llama-3.1-70b-instruct"
    
    current_llm = ChatNVIDIA(
        model=model_name,
        api_key=API_KEY,
        temperature=0.7 if mode == "thinking" else 1.0, # Lower temperature for thinking
        top_p=0.9,
        max_tokens=4096,
    )

    print(f"\n🚀 Thinking (Level: {level}, Mode: {mode}, Model: {model_name})...\n")
    # Step 1: Check if any documents exist at all
    docs_exist = has_uploaded_docs(session_id)

    # Step 2: If docs exist, try local search
    retrieved_docs = []
    if docs_exist:
        # Retrieve more context in thinking mode
        n_results = 10 if mode == "thinking" else 4
        where_clause = {"session_id": str(session_id)} if session_id else None
        
        results = collection.query(
            query_texts=[query],
            n_results=n_results,
            where=where_clause
        )
        retrieved_docs = results.get("documents", [])

    has_local_data = retrieved_docs and any(retrieved_docs[0])

    # Step 2.5: Handle pinned contexts
    pinned_context_str = ""
    if pinned_contexts and len(pinned_contexts) > 0:
        pinned_context_str = "The user has explicitly pinned the following prior messages as core context for this query:\n"
        for pc in pinned_contexts:
            pinned_context_str += f"- {pc}\n"
        pinned_context_str += "\nUse this pinned context prominently to guide your answer.\n\n"

    if has_local_data:
        # ✅ Found relevant local chunks
        system_prompt = f"""
        You are Intellectra, a world-class AI tutor. 
        (Internal Note: You are currently running on the '{model_name}' model. If the user asks which model you are, explicitly state this model name.)
        Your goal is to help the user learn and understand.
        {level_instruction}
        
        {pinned_context_str}
        Use the following document segments to answer accurately. 
        If the data is insufficient, say so and use your own knowledge.
        --------------------
        {retrieved_docs}
        """
    else:
        # Step 3: If no local data or no docs yet, decide what to do
        if docs_exist:
            print("🌐 No relevant local data found. Searching the web...\n")
            
            search_results = []
            try:
                if len(query.split()) > 2:
                    with DDGS() as ddgs:
                        for r in ddgs.text(query, max_results=5):
                            search_results.append(f"{r['title']}: {r['body']} ({r['href']})")
            except Exception as e:
                print("⚠️ Web search failed:", e)
                search_results = []

            if search_results:
                system_prompt = f"""
                You are Intellectra, a world-class AI tutor.
                (Internal Note: You are currently running on the '{model_name}' model. If the user asks which model you are, explicitly state this model name.)
                {level_instruction}
                
                {pinned_context_str}
                No relevant uploaded documents found, so use these web results to help:
                --------------------
                {search_results}
                """
            else:
                system_prompt = f"""
                You are Intellectra, a friendly and concise AI tutor.
                (Internal Note: You are currently running on the '{model_name}' model. If the user asks which model you are, explicitly state this model name.)
                {level_instruction}
                
                {pinned_context_str}
                Respond naturally using your own general knowledge.
                """

        else:
            # ✅ No documents at all — act as a normal tutor
            system_prompt = f"""
            You are Intellectra, a world-class AI tutor.
            (Internal Note: You are currently running on the '{model_name}' model. If the user asks which model you are, explicitly state this model name.)
            {level_instruction}
            
            {pinned_context_str}
            No documents have been uploaded yet. Respond naturally and helpfully using your knowledge.
            """

    # Step 4: Generate response using NVIDIA model
    messages_to_send = [SystemMessage(content=system_prompt)]
    if chat_history:
        for msg in chat_history[-10:]:
            if msg["sender"] == "user":
                messages_to_send.append(HumanMessage(content=msg["text"]))
            elif msg["sender"] == "ai":
                messages_to_send.append(AIMessage(content=msg["text"]))
    
    messages_to_send.append(HumanMessage(content=query))
    
    # Extract sources if they exist (need them for both stream and non-stream)
    sources = []
    if has_local_data:
        try:
            metas = results.get("metadatas", [])
            if metas:
                sources = list(set([m["source"] for m in metas[0] if "source" in m]))
        except Exception:
            sources = []

    if stream:
        return current_llm.stream(messages_to_send), sources
    else:
        response = current_llm.invoke(messages_to_send)
        return {
            "response": response.content,
            "sources": sources
        }

# ----------------------------
# Helper: Generate Flashcards
# ----------------------------
def generate_flashcards(text):
    system_prompt = """
    You are an AI tutor tool designed to extract key concepts from educational text and convert them into flashcards.
    Extract the most important facts, definitions, or concepts from the provided text and formulate them as clear, concise Question/Answer pairs.
    You MUST output valid JSON only. Do not wrap it in markdown code blocks.
    The JSON structure MUST be an array of objects, like this:
    [
        {"front": "What is ...?", "back": "It is ..."},
        {"front": "...", "back": "..."}
    ]
    Limit to a maximum of 5 most critical flashcards.
    """
    try:
        messages = [
            SystemMessage(content=system_prompt),
            HumanMessage(content=f"Extract flashcards from this text:\n\n{text}")
        ]
        response = llm.invoke(messages)
        content = response.content.strip()
        import json
        import re
        
        # Robustly extract JSON array using regex
        match = re.search(r'\[\s*\{.*\}\s*\]', content, re.DOTALL)
        if match:
            json_str = match.group(0)
        else:
            # Fallback cleanup
            json_str = content.strip()
            if json_str.startswith("```json"):
                json_str = json_str[7:]
            elif json_str.startswith("```"):
                json_str = json_str[3:]
            if json_str.endswith("```"):
                json_str = json_str[:-3]
        
        cards = json.loads(json_str.strip())
        return cards
    except Exception as e:
        print(f"Error generating flashcards: {e}")
        return []

# print("🤖 Tutor AI ready! Type your questions, or upload files with: upload <path>")
# while True:
#     user_input = input("\n> ")
    
#     if user_input.lower() == "quit":
#         break
#     elif user_input.startswith("upload "):
#         file_path = user_input.split("upload ", 1)[1].strip()
#         load_and_store(file_path)
#     else:
#         answer = answer_query(user_input)
#         print(f"\nAI Response:\n{answer}")
# # ----------------------------
# # Disabled terminal chat (handled by Flask)
# # ----------------------------
# ----------------------------
# Helper: Generate Quiz
# ----------------------------
def generate_quiz(text):
    system_prompt = """
    You are an AI tutor tool designed to extract key concepts from educational text and convert them into a multiple-choice quiz.
    Extract the most important facts or concepts from the provided text and formulate 3 Multiple-Choice Questions (MCQs).
    You MUST output valid JSON only. Do not wrap it in markdown code blocks.
    The JSON structure MUST be an array of objects, exactly like this:
    [
        {
            "question": "What is the capital of France?",
            "options": ["London", "Berlin", "Paris", "Madrid"],
            "answer": 2
        }
    ]
    IMPORTANT: The 'answer' field must be an integer representing the 0-based index of the correct option in the 'options' array.
    Limit to exactly 3 questions.
    """
    try:
        messages = [
            SystemMessage(content=system_prompt),
            HumanMessage(content=f"Extract a quiz from this text:\n\n{text}")
        ]
        response = llm.invoke(messages)
        content = response.content.strip()
        
        import json
        import re
        
        # Robustly extract JSON array using regex
        match = re.search(r'\[\s*\{.*\}\s*\]', content, re.DOTALL)
        if match:
            json_str = match.group(0)
        else:
            # Fallback cleanup
            json_str = content.strip()
            if json_str.startswith("```json"):
                json_str = json_str[7:]
            elif json_str.startswith("```"):
                json_str = json_str[3:]
            if json_str.endswith("```"):
                json_str = json_str[:-3]
        
        quiz_data = json.loads(json_str.strip())
        return quiz_data
    except Exception as e:
        print(f"Error generating quiz: {e}")
        return []

# ----------------------------
# Helper: Concept Check Generation
# ----------------------------
def generate_concept_questions(text):
    system_prompt = """
    You are an AI tutor designed to assess a student's understanding of a specific concept.
    Based on the provided text, generate 3 open-ended diagnostic questions that will help gauge how well the user truly understands the core ideas.
    Avoid simple yes/no questions. Ask "why" or "how" questions that require a short explanation.
    You MUST output valid JSON only. Do not wrap it in markdown code blocks.
    The JSON structure MUST be an array of strings, like this:
    [
        "Why is X important in the context of Y?",
        "How would you explain Z to a beginner?",
        "What happens if we remove W from the system?"
    ]
    Limit to exactly 3 questions.
    """
    try:
        messages = [
            SystemMessage(content=system_prompt),
            HumanMessage(content=f"Generate diagnostic questions for this text:\n\n{text}")
        ]
        response = llm.invoke(messages)
        content = response.content.strip()
        
        import json
        import re
        
        match = re.search(r'\[\s*".*"\s*\]', content, re.DOTALL)
        if match:
            json_str = match.group(0)
        else:
            json_str = content.strip()
            if json_str.startswith("```json"):
                json_str = json_str[7:]
            elif json_str.startswith("```"):
                json_str = json_str[3:]
            if json_str.endswith("```"):
                json_str = json_str[:-3]
        
        questions = json.loads(json_str.strip())
        return [{"question": q, "answer": ""} for q in questions]
    except Exception as e:
        print(f"Error generating concept questions: {e}")
        return []

# ----------------------------
# Helper: Concept Check Evaluation
# ----------------------------
def evaluate_concept_answers(questions, answers, original_text):
    system_prompt = """
    You are an expert AI tutor. The user was learning about a concept and I asked them a few diagnostic questions.
    I will provide the original text they read, the questions asked, and their answers.
    Your task is to:
    1. Briefly acknowledge their effort.
    2. Provide a SHORT, simple evaluation of what they know and what they don't know based on their answers (e.g., "You have a good grasp of X, but you missed Y.").
    3. Conclude by explicitly asking: "If you want me to explain this concept according to this evaluation, just say so, or tell me 'I already know that'."
    DO NOT provide the full explanation yet. Keep it concise.
    """
    
    q_and_a = ""
    for idx, (q, a) in enumerate(zip(questions, answers)):
        q_and_a += f"Q{idx+1}: {q}\nUser's Answer: {a}\n\n"
        
    prompt = f"""
    ORIGINAL CONCEPT TEXT:
    {original_text}
    
    DIAGNOSTIC Q&A:
    {q_and_a}
    
    Please evaluate and provide the tailored explanation.
    """
    
    try:
        messages = [
            SystemMessage(content=system_prompt),
            HumanMessage(content=prompt)
        ]
        response = llm.invoke(messages)
        return response.content.strip()
    except Exception as e:
        print(f"Error evaluating concept answers: {e}")
        return "I encountered an error while evaluating your answers. Please try again."

if __name__ == "__main__":
    print("✅ API module loaded. Flask will handle all interactions.")
