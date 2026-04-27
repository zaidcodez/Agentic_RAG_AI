# import chromadb
# from dotenv import load_dotenv
# from langchain_ollama import ChatOllama
# from langchain.schema import HumanMessage, SystemMessage

# load_dotenv()

# # Paths
# DATA_PATH = r"data"
# CHROMA_PATH = r"chroma_db"

# # ChromaDB client
# chroma_client = chromadb.PersistentClient(path=CHROMA_PATH)
# collection = chroma_client.get_or_create_collection(name="chroma")

# # User query
# user_query = input("Hello\n\n")

# results = collection.query(
#     query_texts=[user_query],
#     n_results=4
# )

# # Extract retrieved docs
# retrieved_docs = results["documents"]

# # Build system prompt
# system_prompt = f"""
# You are a helpful assistant. If met with a greeting, you reply with a greeting.
# You only answer based on the knowledge I'm providing you. 
# You don't use internal knowledge and you don't make things up.
# If you don't know the answer, just say: I don't know.
# --------------------
# The data:
# {retrieved_docs}
# """

# # Initialize Ollama TinyLlama model
# llm = ChatOllama(model="tinyllama:1.1b")

# # Run conversation
# response = llm([
#     SystemMessage(content=system_prompt),
#     HumanMessage(content=user_query)
# ])

# print("\n\n---------------------\n\n")
# print(response.content)


############################################
##GPT RESPONSE BELOW##, ABOVE IS MY CODE
#############################################

# import os
# import chromadb
# from dotenv import load_dotenv
# from langchain_ollama import ChatOllama
# from langchain.schema import HumanMessage, SystemMessage
# from langchain_community.document_loaders import Docx2txtLoader, PyPDFLoader, UnstructuredPowerPointLoader
# from langchain.text_splitter import RecursiveCharacterTextSplitter
# from sentence_transformers import SentenceTransformer

import os
import chromadb
from dotenv import load_dotenv
from langchain_ollama import ChatOllama
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_community.document_loaders import (
    Docx2txtLoader,
    PyPDFLoader,
    UnstructuredPowerPointLoader
)
from langchain_text_splitters import RecursiveCharacterTextSplitter
from sentence_transformers import SentenceTransformer

# ----------------------------
# Setup
# ----------------------------
load_dotenv()

DATA_PATH = r"data"
CHROMA_PATH = r"chroma_db"

# ChromaDB client
chroma_client = chromadb.PersistentClient(path=CHROMA_PATH)
collection = chroma_client.get_or_create_collection(name="chroma")

# Embedding model
embedder = SentenceTransformer("all-MiniLM-L6-v2")

# LLM
llm = ChatOllama(model="llama2:7b")

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
    
    for i, chunk in enumerate(chunks):
        emb = embedder.encode(chunk.page_content).tolist()
        collection.add(
            documents=[chunk.page_content],
            metadatas=[{"source": file_path}],
            ids=[f"{file_path}_{i}"],
            embeddings=[emb]
        )
    print(f"✅ Added {len(chunks)} chunks from {file_path}")

# ----------------------------
# Helper: Answer query
# ----------------------------
def answer_query(query):
    results = collection.query(
        query_texts=[query],
        n_results=4
    )
    retrieved_docs = results["documents"]

    if retrieved_docs and any(retrieved_docs[0]):  # check if docs exist
        system_prompt = f"""
        You are a helpful assistant.
        You can chat naturally with the user.
        If relevant, use the knowledge I'm providing you to answer.
        If the docs don't cover the question, feel free to answer normally.
        --------------------
        The data:
        {retrieved_docs}
        """
    else:
        system_prompt = "You are a helpful assistant. Chat naturally with the user."

    response = llm.invoke([
        SystemMessage(content=system_prompt),
        HumanMessage(content=query)
    ])

    return response.content

# ----------------------------
# Chat loop
# ----------------------------
print("🤖 Tutor AI ready! Type your questions, or upload files with: upload <path>")
while True:
    user_input = input("\n> ")
    
    if user_input.lower() == "quit":
        break
    elif user_input.startswith("upload "):
        file_path = user_input.split("upload ", 1)[1].strip()
        load_and_store(file_path)
    else:
        answer = answer_query(user_input)
        print(f"\nAI: {answer}")