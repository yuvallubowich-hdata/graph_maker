import os
from dotenv import load_dotenv
import openai

def test_openai_connection():
    load_dotenv()
    openai.api_key = os.getenv('OPENAI_API_KEY')
    
    try:
        response = openai.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[
                {"role": "user", "content": "Hello, this is a test message."}
            ]
        )
        print("OpenAI API connection successful!")
        print("Response:", response.choices[0].message.content)
        return True
    except Exception as e:
        print("Error connecting to OpenAI API:", str(e))
        return False

if __name__ == "__main__":
    test_openai_connection() 