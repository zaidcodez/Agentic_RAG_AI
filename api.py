import os
import chromadb
from dotenv import load_dotenv
from langchain.schema import HumanMessage, SystemMessage
from langchain_community.document_loaders import Docx2txtLoader, PyPDFLoader, UnstructuredPowerPointLoader
from langchain.text_splitter import RecursiveCharacterTextSplitter
from sentence_transformers import SentenceTransformer
from langchain_nvidia_ai_endpoints import ChatNVIDIA

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
    model="deepseek-ai/deepseek-r1",
    api_key=API_KEY,
    temperature=0.6,
    top_p=0.7,
    max_tokens=4096,
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

    # Handle reasoning output if available
    if response.additional_kwargs and "reasoning_content" in response.additional_kwargs:
        print("🧠 Reasoning:\n", response.additional_kwargs["reasoning_content"])

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
