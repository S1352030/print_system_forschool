"""
LINE Notify 通知模塊
===================
設定說明：
  1. 前往 LINE Notify 個人頁面：https://notify-bot.line.me/zh_TW/
  2. 登入你的 LINE 帳號，並點選「發行權杖」(Generate token)。
  3. 輸入權杖名稱（例如「影印系統」），並選擇要接收通知的聊天室（可以是個人聊天室或群組）。
  4. 點選「發行」，複製產生的權杖（Token），填入下方的 LINE_ACCESS_TOKEN。
  5. 如果是群組，請記得將「LINE Notify」官方帳號邀請進入該群組。
"""

import requests
from datetime import datetime

# ── 請將以下變數替換成你自己的設定 ──────────────────────────────────────
LINE_ACCESS_TOKEN = "在此貼上你的 LINE Access Token"  # 範例："your_line_notify_token_here"
# ────────────────────────────────────────────────────────────────────────────

LINE_API_URL = "https://notify-api.line.me/api/notify"


def send_line_notification(
    user_name: str,
    file_name: str,
    total_pages: int,
    total_price: float,
) -> dict:
    """
    發送新訂單通知至 LINE。

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
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # LINE Notify 不支援 Markdown 語法，所以我們用純文字搭配適當排版與 Emoji
    message = (
        "\n🖨️ 新訂單通知\n"
        "━━━━━━━━━━━━━━━━━━\n"
        f"👤 上傳者：{user_name}\n"
        f"📄 檔名：{file_name}\n"
        f"📋 頁數：{total_pages} 頁\n"
        f"💰 應收金額：NT$ {total_price:.0f} 元\n"
        "━━━━━━━━━━━━━━━━━━\n"
        f"🕐 時間：{now}"
    )

    headers = {
        "Authorization": f"Bearer {LINE_ACCESS_TOKEN}"
    }
    payload = {
        "message": message
    }

    try:
        response = requests.post(LINE_API_URL, headers=headers, data=payload, timeout=10)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.Timeout:
        return {"error": "請求逾時，請確認網路連線後再試。"}
    except requests.exceptions.ConnectionError:
        return {"error": "無法連線至 LINE API，請檢查網路或 LINE_ACCESS_TOKEN 是否正確。"}
    except requests.exceptions.HTTPError as e:
        return {"error": f"HTTP 錯誤：{e}", "response": response.text}
    except Exception as e:
        return {"error": f"未預期的錯誤：{e}"}


# ── 快速測試（直接執行此檔案時觸發）────────────────────────────────────────
if __name__ == "__main__":
    result = send_line_notification(
        user_name="王小明",
        file_name="畢業論文_終稿.pdf",
        total_pages=48,
        total_price=240.0,
    )

    if "error" in result:
        print(f"[FAIL] 發送失敗：{result['error']}")
    else:
        print("[SUCCESS] 通知發送成功！")
        print(f"   LINE 回應：{result}")
