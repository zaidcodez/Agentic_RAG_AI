from ddgs import DDGS
import traceback

try:
    with DDGS() as ddgs:
        results = ddgs.text(
            "What is artificial intelligence",
            region="wt-wt",
            safesearch="off",
            max_results=5,
            backend="html"
        )

        print("RESULTS START")
        for r in results:
            print(r)
        print("RESULTS END")

except Exception:
    print("FAILED:")
    traceback.print_exc()