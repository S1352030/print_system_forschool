"""
LINE Messaging API 通知模塊
==========================
設定說明：
  1. 前往 LINE Developers 主頁：https://developers.line.biz/
  2. 登入後在 Provider 下建立一個 Messaging API Channel (即可得到一個 LINE 官方帳號)。
  3. 進入該 Channel 的「Messaging API」頁籤，在最底下找到並發行：
     - **Channel access token (long-lived)** -> 複製填入 LINE_CHANNEL_ACCESS_TOKEN。
  4. 進入該 Channel 的「Basic settings」頁籤，在中間位置找到：
     - **Your user ID** -> 複製填入 LINE_RECEIVER_ID (此為你的個人 LINE 專屬識別碼，格式如 U123456789...)。
  5. 用你的 LINE 掃描該頁面的 QR Code 追蹤你的 LINE 官方帳號。
"""

import os
import requests
from datetime import datetime
from dotenv import load_dotenv

# 載入 .env 檔案設定
load_dotenv()

# ── 金鑰與接收者設定（優先從環境變數載入，若無則使用此處設定） ───────────────────────
LINE_CHANNEL_ACCESS_TOKEN = os.getenv("LINE_CHANNEL_ACCESS_TOKEN", "在此貼上你的 Channel Access Token")
LINE_RECEIVER_ID = os.getenv("LINE_RECEIVER_ID", "在此貼上你的 LINE User ID (U...)")
# ────────────────────────────────────────────────────────────────────────────

LINE_API_URL = "https://api.line.me/v2/bot/message/push"


def send_line_notification(
    user_name: str,
    file_name: str,
    total_pages: int,
    total_price: float,
) -> dict:
    """
    發送新訂單通知至 LINE 官方帳號 (Messaging API)。

    Parameters
    ----------
    user_name   : 上傳者姓名或帳號
    file_name   : 上傳的 PDF 檔名
    total_pages : 總頁數
    total_price : 應收金額（新台幣）

    Returns
    -------
    dict : LINE API 的回應內容；若發送失敗則包含 'error' 鍵。
    """
    # 檢查是否尚未設定金鑰
    if "在此貼上" in LINE_CHANNEL_ACCESS_TOKEN or "在此貼上" in LINE_RECEIVER_ID:
        err_msg = "LINE 金鑰或接收者 ID 尚未設定，請先設定 LINE_CHANNEL_ACCESS_TOKEN 與 LINE_RECEIVER_ID。"
        print(f"[LINE Notify Warning] {err_msg}")
        return {"error": err_msg}

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # 訊息排版與 Emoji
    message = (
        "🖨️ 新訂單通知\n"
        "━━━━━━━━━━━━━━━━━━\n"
        f"👤 上傳者：{user_name}\n"
        f"📄 檔名：{file_name}\n"
        f"📋 頁數：{total_pages} 頁\n"
        f"💰 應收金額：NT$ {total_price:.0f} 元\n"
        "━━━━━━━━━━━━━━━━━━\n"
        f"🕐 時間：{now}"
    )

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {LINE_CHANNEL_ACCESS_TOKEN}"
    }
    payload = {
        "to": LINE_RECEIVER_ID,
        "messages": [
            {
                "type": "text",
                "text": message
            }
        ]
    }

    try:
        response = requests.post(LINE_API_URL, headers=headers, json=payload, timeout=10)
        # 如果是 200 OK，代表發送成功，Messaging API 成功會回傳空 JSON {}
        response.raise_for_status()
        
        # Messaging API 成功時回應通常為空或 {}
        if response.text.strip() == "":
            return {"status": "success"}
        return response.json()
    except requests.exceptions.Timeout:
        return {"error": "請求逾時，請確認網路連線。"}
    except requests.exceptions.ConnectionError:
        return {"error": "無法連線至 LINE API，請檢查網路或金鑰設定。"}
    except requests.exceptions.HTTPError as e:
        return {"error": f"HTTP 錯誤：{e}", "response": response.text}
    except Exception as e:
        return {"error": f"未預期的錯誤：{e}"}


# ── 快速測試（直接執行此檔案時觸發） ────────────────────────────────────────
if __name__ == "__main__":
    print("正在測試傳送 LINE 訊息...")
    result = send_line_notification(
        user_name="測試管理員",
        file_name="測試影印檔案.pdf",
        total_pages=5,
        total_price=5.0,
    )

    if "error" in result:
        print(f"[FAIL] 發送失敗：{result['error']}")
        if "response" in result:
            print(f"   詳細錯誤資訊：{result['response']}")
    else:
        print("[SUCCESS] 通知發送成功！請檢查您的 LINE 官方帳號對話視窗。")
