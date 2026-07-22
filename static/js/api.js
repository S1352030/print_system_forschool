/**
 * API 存取層
 * 統一封裝 fetch 呼叫與錯誤處理。
 *
 * 錯誤回應格式(對齊 M2.7 全域 exception handler):
 *   { error: "internal_server_error", detail: "伺服器發生內部錯誤..." }
 *   或 FastAPI HTTPException 的 { detail: "..." }
 */

/**
 * 統一的 API 錯誤類別,承載後端回傳的 error/detail 與 status code。
 */
export class ApiError extends Error {
  constructor(message, { status, error, detail } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.error = error;
    this.detail = detail;
  }
}

/**
 * 從 Response 物件解析出友善的錯誤訊息。
 * 優先使用後端的 detail,其次 error,最後用 status code 對照。
 */
async function _extractErrorMessage(response) {
  let body = null;
  try {
    body = await response.json();
  } catch (e) {
    // 非 JSON 回應(例如 nginx 502 HTML 頁面)
    return `${response.status} ${response.statusText}`;
  }
  if (body && typeof body === 'object') {
    // 制式錯誤格式
    if (body.detail) return body.detail;
    if (body.error) return body.error;
    // Pydantic 422 驗證錯誤(detail 是陣列)
    if (Array.isArray(body.detail)) {
      const first = body.detail[0];
      if (first && first.msg) return `參數錯誤:${first.msg}`;
    }
  }
  return `${response.status} ${response.statusText}`;
}

/**
 * GET 請求封裝。
 * @returns {Promise<any>} 解析後的 JSON
 * @throws {ApiError} 非 2xx 時
 */
export async function apiGet(url) {
  const response = await fetch(url, { method: 'GET' });
  if (!response.ok) {
    const msg = await _extractErrorMessage(response);
    throw new ApiError(msg, { status: response.status });
  }
  return response.json();
}

/**
 * POST 請求封裝(支援 FormData 與 JSON body)。
 */
export async function apiPost(url, body, { isForm = false } = {}) {
  const headers = isForm ? {} : { 'Content-Type': 'application/json' };
  const payload = isForm ? body : JSON.stringify(body);
  const response = await fetch(url, { method: 'POST', headers, body: payload });
  if (!response.ok) {
    const msg = await _extractErrorMessage(response);
    throw new ApiError(msg, { status: response.status });
  }
  return response.json();
}

/**
 * PUT 請求封裝(JSON body)。
 */
export async function apiPut(url, body) {
  const response = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const msg = await _extractErrorMessage(response);
    throw new ApiError(msg, { status: response.status });
  }
  return response.json();
}

/**
 * DELETE 請求封裝。
 */
export async function apiDelete(url) {
  const response = await fetch(url, { method: 'DELETE' });
  if (!response.ok) {
    const msg = await _extractErrorMessage(response);
    throw new ApiError(msg, { status: response.status });
  }
  return response.json();
}

/**
 * 帶有上傳進度的 POST(用 XMLHttpRequest,因為 fetch 沒有原生 upload progress)。
 * @param {string} url
 * @param {FormData} formData
 * @param {(percent:number)=>void} onProgress 0-100 的進度回呼
 * @returns {Promise<any>} 解析後的 JSON
 */
export function apiPostWithProgress(url, formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.responseType = 'json';

    if (onProgress && xhr.upload) {
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      });
    }

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.response);
      } else {
        // 嘗試從 response 解析錯誤訊息
        let msg = `${xhr.status} ${xhr.statusText}`;
        if (xhr.response && typeof xhr.response === 'object') {
          if (xhr.response.detail) msg = xhr.response.detail;
          else if (xhr.response.error) msg = xhr.response.error;
        }
        reject(new ApiError(msg, { status: xhr.status }));
      }
    });

    xhr.addEventListener('error', () => {
      reject(new ApiError('網路錯誤,無法連線至伺服器。', { status: 0 }));
    });

    xhr.addEventListener('abort', () => {
      reject(new ApiError('上傳已取消。', { status: 0 }));
    });

    xhr.addEventListener('timeout', () => {
      reject(new ApiError('上傳逾時,請檢查網路連線後重試。', { status: 0 }));
    });

    xhr.send(formData);
  });
}
