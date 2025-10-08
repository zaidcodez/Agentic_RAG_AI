import os
import chromadb
from dotenv import load_dotenv
from langchain.schema import HumanMessage, SystemMessage
from langchain_community.document_loaders import Docx2txtLoader, PyPDFLoader, UnstructuredPowerPointLoader
from langchain.text_splitter import RecursiveCharacterTextSplitter
from sentence_transformers import SentenceTransformer
from langchain_nvidia_ai_endpoints import ChatNVIDIA
from duckduckgo_search import DDGS  # ✅ For web search fallback

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
    model="deepseek-ai/deepseek-r1-0528",
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
def answer_query(query):
    query_lower = query.strip().lower()

    # Step 0: If user says something casual, stay neutral and short
    if query_lower in ["hi", "hello", "hey", "what’s up", "yo", "good morning", "good evening"]:
        return "Hey there! 😊 How can I help you today?"

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
        # Found relevant local chunks
        system_prompt = f"""
        You are a helpful assistant.
        Use the following uploaded document data if relevant to answer accurately.
        If the question is casual or unrelated to the documents, reply naturally and concisely.
        --------------------
        {retrieved_docs}
        """
    else:
        # Step 3: If no local data or no docs yet, try web search for factual queries
        if docs_exist:
            print("🌐 No relevant local data found. Searching the web...")
        else:
            print("ℹ️ No documents uploaded yet. Searching the web if relevant...")

        search_results = []
        try:
            # Web search only for non-casual queries
            if len(query.split()) > 2:  # Avoid websearch for greetings or 1-word queries
                with DDGS() as ddgs:
                    for r in ddgs.text(query, max_results=5):
                        search_results.append(f"{r['title']}: {r['body']} ({r['href']})")
        except Exception as e:
            print("⚠️ Web search failed:", e)
            search_results = []

        if search_results:
            system_prompt = f"""
            You are a helpful assistant with access to real-time web data.
            Use the following web results to provide an accurate and concise answer:
            --------------------
            {search_results}
            """
        else:
            system_prompt = (
                "You are a friendly, concise assistant. "
                "No documents or useful web data are available. "
                "Respond briefly and naturally."
            )

    # Step 4: Generate response using NVIDIA model
    response = llm.invoke([
        SystemMessage(content=system_prompt),
        HumanMessage(content=query)
    ])

    # Optional: Log reasoning for debugging
    if response.additional_kwargs and "reasoning_content" in response.additional_kwargs:
        print("🧠 Reasoning:\n", response.additional_kwargs["reasoning_content"])

    return response.content

# ----------------------------
# Disabled terminal chat (handled by Flask)
# ----------------------------
if __name__ == "__main__":
    print("✅ API module loaded. Flask will handle all interactions.")
