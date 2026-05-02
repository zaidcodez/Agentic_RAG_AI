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

# NVIDIA LLM client
llm = ChatNVIDIA(
    model="nvidia/nemotron-3-super-120b-a12b",
    api_key=API_KEY,
    temperature=1,
    top_p=0.95,
    max_tokens=16384,
)

# Text splitter for chunking
splitter = RecursiveCharacterTextSplitter(chunk_size=800, chunk_overlap=100)

# ----------------------------
# Helper: Load and store documents
# ----------------------------
def load_and_store(file_path):
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
        collection.add(
            documents=[chunk.page_content],
            metadatas=[{"source": filename}],
            ids=[f"{filename}_{i}"],
            embeddings=[emb]
        )
    print(f"✅ Added {len(chunks)} chunks from {file_path}")

# ----------------------------
# Helper: Detect if any docs exist in ChromaDB
# ----------------------------
def has_uploaded_docs():
    try:
        count = len(collection.get(include=["documents"])["documents"])
        return count > 0
    except Exception:
        return False

# ----------------------------
# Helper: Answer query
# ----------------------------
def answer_query(query, chat_history=None, level="standard"):
    query_lower = query.strip().lower()

    # Step 0: Study Level Instructions
    level_instruction = ""
    if level == "eli5":
        level_instruction = "IMPORTANT: Use the 'Explain Like I'm 5' approach. Use simple analogies, avoid complex jargon, and break down concepts into their most basic parts."
    elif level == "advanced":
        level_instruction = "IMPORTANT: Provide an in-depth, academic, and technical response. Use precise terminology, explore nuances, and assume the user has prior knowledge of the subject."
    else:
        level_instruction = "IMPORTANT: Provide a clear, balanced, and helpful explanation suitable for a standard student level."

    # Step 0.1: Casual greetings
    if query_lower in ["hi", "hello", "hey", "what’s up", "yo", "good morning", "good evening"]:
        return {
            "response": "Hey there! 😊 How can I help you today?",
            "sources": []
        }

    print(f"\n🚀 Thinking (Level: {level})...\n")
    # Step 1: Check if any documents exist at all
    docs_exist = has_uploaded_docs()

    # Step 2: If docs exist, try local search
    retrieved_docs = []
    if docs_exist:
        results = collection.query(
            query_texts=[query],
            n_results=4
        )
        retrieved_docs = results.get("documents", [])

    has_local_data = retrieved_docs and any(retrieved_docs[0])

    if has_local_data:
        # ✅ Found relevant local chunks
        system_prompt = f"""
        You are Intellectra, a world-class AI tutor. 
        Your goal is to help the user learn and understand.
        {level_instruction}
        
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
                {level_instruction}
                
                No relevant uploaded documents found, so use these web results to help:
                --------------------
                {search_results}
                """
            else:
                system_prompt = f"""
                You are Intellectra, a friendly and concise AI tutor.
                {level_instruction}
                Respond naturally using your own general knowledge.
                """

        else:
            # ✅ No documents at all — act as a normal tutor
            system_prompt = f"""
            You are Intellectra, a world-class AI tutor.
            {level_instruction}
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
    response = llm.invoke(messages_to_send)

    # Extract sources if they exist
    sources = []
    if has_local_data:
        try:
            # results is from the earlier collection.query call
            metas = results.get("metadatas", [])
            if metas:
                sources = list(set([m["source"] for m in metas[0] if "source" in m]))
        except Exception:
            sources = []

    return {
        "response": response.content,
        "sources": sources
    }



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
if __name__ == "__main__":
    print("✅ API module loaded. Flask will handle all interactions.")
