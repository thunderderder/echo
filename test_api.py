import os
import httpx
import asyncio
from dotenv import load_dotenv
from pathlib import Path

# 加载环境变量
env_path = Path(".env")
load_dotenv(dotenv_path=env_path, override=True)

api_key = os.getenv("OPENAI_API_KEY")
# 默认base_url，但我们会测试其他的
base_url = os.getenv("BASE_URL", "https://space.ai-builders.com/api/v1")

if not api_key:
    print("错误: 未找到 OPENAI_API_KEY")
    exit(1)

# 清理 API Key BOM
if api_key.startswith('\ufeff'):
    api_key = api_key.lstrip('\ufeff')

print(f"API Key: {api_key[:5]}...{api_key[-5:]}")

async def test_transcribe():
    print("\n--- 探测正确的 Base URL ---")
    # 尝试不同的 Base URL 模式
    base_urls = [
        "https://space.ai-builders.com/backend/v1",
        "https://space.ai-builders.com/backend",
        "https://space.ai-builders.com/api/v1", # 保留原来的作为对比
    ]

    correct_base_url = None

    async with httpx.AsyncClient() as client:
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }
        data = {
            "model": "gpt-3.5-turbo", 
            "messages": [{"role": "user", "content": "Hello"}]
        }

        for url_base in base_urls:
            chat_url = f"{url_base}/chat/completions"
            print(f"\n尝试 Chat URL: {chat_url}")
            try:
                response = await client.post(chat_url, json=data, headers=headers)
                print(f"状态码: {response.status_code}")
                # 400, 401, 403, 422 也说明路径是对的（只是参数或鉴权问题）
                # 404, 405 说明路径不对
                if response.status_code not in [404, 405]:
                    print("!!! 找到可能的 Base URL !!!")
                    print(f"响应: {response.text[:200]}")
                    correct_base_url = url_base
                    break # 找到能用的就停止
            except Exception as e:
                print(f"请求失败: {e}")

    if correct_base_url:
        print(f"\n--- 使用 Base URL: {correct_base_url} 测试 Audio API ---")
        audio_url = f"{correct_base_url}/audio/transcriptions"
        print(f"Audio URL: {audio_url}")
        
        # 创建伪造音频文件
        filename = "test_audio.webm"
        if os.path.exists(filename):
            try: os.remove(filename)
            except: pass
        with open(filename, "wb") as f:
            f.write(b"fake audio content")

        try:
            async with httpx.AsyncClient() as client:
                headers = {"Authorization": f"Bearer {api_key}"}
                files = {'audio_file': (filename, open(filename, "rb"), "audio/webm")}
                
                print("发送 Audio 请求...")
                response = await client.post(audio_url, files=files, headers=headers)
                print(f"Audio API 状态码: {response.status_code}")
                print(f"响应: {response.text}")
        except Exception as e:
            print(f"Audio 测试失败: {e}")
        finally:
            if os.path.exists(filename):
                try: os.remove(filename)
                except: pass
    else:
        print("\n未能找到正确的 Base URL")

if __name__ == "__main__":
    asyncio.run(test_transcribe())
